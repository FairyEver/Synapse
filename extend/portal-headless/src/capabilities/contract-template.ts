import type { CapabilityDefinition, ParamSpec } from './types.js'
import type { PageResult, PortalRequest } from './meeting-room.js'

/**
 * 合同模板 —— 合同域（风控管理）的第一个页面，形态是**普通 REST 增删改**，
 * 但写链路上有一条「审批流程」的分叉，这一页真正的判断都在那条分叉上。
 *
 * 页面：`/dashboard/contract/template/list`
 * 路由文件：`app/portal/views/dashboard/hr/contract/template/list.vue`
 * 表单页：**不是一个同目录的 `[mode]/[id].vue`，而是流程表单** `simple/hr/form/007`
 * （`list.vue` 的 `actionCreate` / `actionEdit` 都走 `openFlowFormByPath`）
 *
 * | 动作 | 请求 | 出处 |
 * | --- | --- | --- |
 * | 列表 | `GET /hr/contract-template/page` | `list.vue` 的 `getDataListURL` |
 * | 详情 | `GET /hr/contract-template/get?id=` | 后端 `@GetMapping("/get")`；前端调用点在**详情页** `template/detail/[id].vue` |
 * | 新建 | `POST /hr/contract-template/create` | `simple/hr/form/007/page/pc/edit/index.vue` 的 `actionSubmit` |
 * | 修改 | `PUT /hr/contract-template/update` | 同上（`hasRecord` 分支） |
 * | 删除 | `DELETE /hr/contract-template/delete?id=` | `list.vue` 的 `actionDelete` |
 *
 * 逐字段基准：`baseline/contract-template.browser.json`（读 4 条 + 写 3 条，全是实测）
 * 四件套记录：`docs/pages/合同模板.md`
 *
 * ## 这一页最要紧的一条：`onlySubmit` 决定「不发流程」还是「发流程」
 *
 * `create` / `update` 的 body 里有一个 `onlySubmit`（`007` 的 `buildSubmitPayload`）：
 *
 * | 页面按钮 | `onlySubmit` | 后端 `ContractTemplateServiceImpl` 的行为 |
 * | --- | --- | --- |
 * | 「仅保存」 | `1` | `status = PENDING_SUBMIT(1)`，**不起流程**，`hr_contract_template` + 一条 v1 版本落库 |
 * | 「保存并提交」 | `0` | `status = SUBMITTED(2)`，**另外调 `processInstanceApi.createProcessInstance`** 起一条 `contract_template` 审批流 |
 *
 * **SDK 只实现「仅保存」那一支**，把 `onlySubmit` 钉死成 1，并在调用方硬传它时**拒绝**
 * （`assertNoOnlySubmit`）。理由有三条，都不是口味问题：
 *
 * 1. **「保存并提交」会惊动真人**。它起的是真实审批流，会推出待办、发通知。测试环境里
 *    那不是"一条脏数据"，是一串人的待办箱里多出一条假单据。本页的写能力**必须只碰自己
 *    创建的数据**，而流程一旦发出去就不再只碰自己了 —— 所以这条路径**不做、也不测**。
 * 2. **它在前端本来就是坏的。** `007` 在 `submitFlow === true` 时会先打
 *    `POST /hr/contract-template/getRequiredStartUserSelectTasks`，拿不到数组就
 *    `throw new Error('获取审批节点失败')`、整条提交中断。而后端**没有这个映射**
 *    （`WorkflowContractTemplateController` 里没有它；全仓唯一的同名 `@PostMapping`
 *    在 `BusinessRegistrationApplicationController`，路径不同）。所以照抄这个分支
 *    等于照抄一个必然抛错的调用 —— 实测记录见 `docs/pages/合同模板.md`。
 * 3. **钉死成常量而不是开放成参数**，是因为开放它等于给 AI 一个"顺手把流程也发了"的旋钮，
 *    而这条路径既没被验证过、又会打在真人身上。要发流程得先把 `getRequiredStartUserSelectTasks`
 *    那条链补上并单独验证，那是另一件工作。
 *
 * 因此 SDK 发出的 body 与浏览器点「仅保存」时**逐字段一致**（含键的书写顺序）。
 *
 * ## 长选项：这一页没有（D6 在这里不触发）
 *
 * 「类型」是一个 `contract_type` 分类字典，实测只有两层、叶子是「采购合同」这种业务类型，
 * 是**小枚举**，不是几千个人员候选。所以 `typeId` 声明成 `kind: 'tree'` 但**不给 lookup** ——
 * 页面的候选来自通用字典接口 `GET /system/category-dict/getChildNodeTree?code=contract_type`，
 * 那是跨页面的通用设施，不属于本页的能力（见「尚未覆盖」）。
 *
 * ## `remove` 是**逻辑删除**，而且**可能被关联合同挡住**（后端源码 + 实测）
 *
 * `deleteContractTemplate` 先查 `hr_contract` 里有没有 `template_id` 指向它、`deleted = 0`
 * 的合同，有就抛业务错误「存在关联合同，不能删除」；否则把 `hr_contract_template.deleted`
 * 置 1。**SDK 不做预检查**，如实透传这个失败（预检查要另打接口，而且查到"没被用"也不保证
 * 删的时候还没被用）。
 */

export const CONTRACT_TEMPLATE_PAGE_PATH = '/dashboard/contract/template/list'

/** 该页的权限码（`generated/page-catalog.json` 的 `permission`，与菜单树同源） */
export const CONTRACT_TEMPLATE_PERMISSION = '/dashboard/contract/template'

/**
 * 该页的 module-type。
 *
 * `resolveModuleType(CONTRACT_TEMPLATE_PAGE_PATH)` → 15 风险防控，与浏览器在**列表页**
 * 与**详情页**上实测发的一致（基准里的四条读请求都是 15）。
 *
 * ⚠️ 基准里那两条**写请求**发的是 11（组织管理）：流程表单跑在
 * `/dashboard/flow/form/edit?…` 这条路由上，那个头读的是 cookie `hr-0.0.0-menuPath`，
 * 由路由守卫在每次导航时写、且**整个浏览器 profile 共享**，在流程表单那条路由上取到的
 * 是上一个页面的值。SDK 的能力全部绑在**列表页路径**上，所以拿到的是 15 ——
 * 与浏览器在列表页上的行为一致，不去复刻它在另一条路由上的"取到什么算什么"。
 * 这条头的坑详见 `docs/pages/合同模板.md`。
 */
export const CONTRACT_TEMPLATE_MODULE_TYPE = 15

/**
 * 列表请求的固定参数表。
 *
 * 依据是浏览器真实发出的 URL（`baseline/contract-template.browser.json`）：
 *
 * ```text
 * /admin-api/hr/contract-template/page?order=&orderField=&pageNo=1&pageSize=20&_t=…
 * /admin-api/hr/contract-template/page?order=&orderField=&name=SDK-TEST-…&pageNo=1&pageSize=20&_t=…
 * /admin-api/hr/contract-template/page?order=&orderField=&typeId=13&pageNo=1&pageSize=20&_t=…
 * ```
 *
 * **顺序即 qs 序列化后的顺序**，所以下面这张表是"契约"，不是"默认值表"（D20 逐字段一致）。
 * `name` 与 `typeId` 的初值都是 `null`，被 qs 的 skipNulls 丢掉 —— 页面上不填时浏览器也不发它们
 * （与班次管理那条线不同：那边 `name` 也是 null，但 `order` / `orderField` 两个空串**一定会发**，
 * 这里同样一定会发）。
 */
const LIST_QUERY: ReadonlyArray<{ name: string; defaultValue: unknown }> = [
  { name: 'order', defaultValue: '' },
  { name: 'orderField', defaultValue: '' },
  { name: 'name', defaultValue: null },
  { name: 'typeId', defaultValue: null },
  { name: 'pageNo', defaultValue: 1 },
  { name: 'pageSize', defaultValue: 20 },
]

/** 默认每页条数。`useListPageModule({ styleV2: true })` → 20（`list.js:391`） */
export const DEFAULT_PAGE_SIZE = 20

/**
 * 页面表单那条默认的「空模板内容」（`007/page/pc/edit/index.vue` 的 `formState.content` 初值）。
 *
 * 实测它**能过前后端两侧的校验**：`validateTemplateConfig` 在 `blocks` 为空数组时不报错，
 * 后端 `ContractContentValidator.validateContent` 只强制 `version` 是非空字符串、
 * `blocks` 是数组。基准里的 `create` / `update` 两条 body 用的就是它。
 *
 * ⇒ 调用方要建一个"有内容"的模板，正确做法是**先 `list` / `get` 抄一份现成模板的 `content`
 * 字符串再改**，而不是自己拼 —— 内容结构（封面 / 自动目录 / 签署信息 / 段落标题）有一整套
 * 跨字段约束（封面必须在首位、自动目录紧随其后、签署信息恰好两方…），自己拼会撞上一串
 * 后端业务错误。SDK 只做「非空 + 是带 version/blocks 的 JSON 对象」这一层本地校验，
 * 更深的规则交给后端如实报错。
 */
export const EMPTY_TEMPLATE_CONTENT = '{"version":"1.0.0","blocks":[]}'

/**
 * 模板状态。来源是**后端枚举** `ContractTemplateStatusEnum`（1/2/3/4/6/7），
 * 与页面的 `statusOptions`（1/2/3/4/7）只差一个 6 —— 页面下拉里没有「关闭」。
 *
 * 这一份只用于描述，**不是**可传的查询参数（见 `assertNoStatusParam`）。
 */
export const CONTRACT_TEMPLATE_STATUS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: '待提交' },
  { value: 2, label: '已提交/审批中' },
  { value: 3, label: '审批拒绝' },
  { value: 4, label: '已完成' },
  { value: 6, label: '关闭' },
  { value: 7, label: '已取消' },
]

export type ContractTemplateRow = {
  /**
   * 记录 id。基准里浏览器回传的是 **number**（`PUT` body 的 `"id":77`），
   * 与班次管理那条线（后端给字符串）**相反**。SDK 原样透传，不做类型归一 ——
   * 归一反而会让 body 与浏览器不一致（D20）。
   */
  id?: number | string
  /** 模板名称 */
  name?: string
  /** 状态，取值见 `CONTRACT_TEMPLATE_STATUS` */
  status?: number
  /** 最新一版的内容 JSON 串（列表接口就会返回它，不一定要再 `get` 一次） */
  content?: string
  /** 最新一版的版本号 */
  version?: number
  /** 模板类型 id（`system_category_dict.id`） */
  typeId?: number | string
  /** 模板类型名（后端 join 出来的，只读） */
  typeName?: string
  /** 所属系统，取值是 `SYSTEM_OPTIONS_ALL` 的 value（0 公共 / 1 人力 / … / 10 平台） */
  useSystem?: number
  /** 关联合同数，列表接口逐行算出来的（只读） */
  contractCount?: number
  /** 最近一次操作人 id / 姓名 */
  updater?: string | number
  updaterName?: string
  /** 最近一次操作时间，`YYYY-MM-DD HH:mm:ss`（取自 `hr_contract_template.update_time`） */
  updateTime?: string
  /** 流程实例 id，只有走过「保存并提交」的模板才有值 */
  processInstanceId?: string
  [key: string]: unknown
}

export type ContractTemplateQuery = {
  /**
   * 模板名称，**模糊匹配**（后端 `selectByPage` 是 `like concat('%', #{name}, '%')`）。
   * ⚠️ 因为是 like，改名后的新名字如果**包含**原名，用原名仍然查得到 ——
   * 判断"改名成没成功"时新名字不能包含原名（这条坑在作业管理、班次管理两条线上都踩过）。
   */
  name?: string
  /** 模板类型 id（分类字典 `contract_type` 的节点 id），**精确匹配** */
  typeId?: number | string
  pageNo?: number
  pageSize?: number
  order?: string
  orderField?: string
}

/**
 * 新建 / 修改的载荷。
 *
 * 页面上真的能填的就三个字段（`007` 的 `formState` 前三个 + 富文本 `content`），
 * `onlySubmit` 由 SDK 钉死成 1，`startUserSelectAssignees` 由 SDK 补成 `{}` ——
 * 两个都不在调用方能传的范围内。
 */
export type ContractTemplateDraft = {
  /** 模板类型 id，页面规则 required */
  typeId: number | string
  /** 模板名称，页面规则 required（**没有**长度上限规则，后端也不限） */
  name: string
  /** 所属系统，页面规则 required。取值是 `SYSTEM_OPTIONS_ALL` 的 value */
  useSystem: number
  /**
   * 合同模板内容，**JSON 字符串**（不是对象）。
   * 抄现成模板最稳：`list` / `get` 返回的 `content` 原样传回来即可。
   * 页面默认值是 `EMPTY_TEMPLATE_CONTENT`。
   */
  content: string
}

/** 修改用的载荷：多一个 `id`。其余字段与新建完全相同 */
export type ContractTemplateUpdateDraft = ContractTemplateDraft & {
  /** 记录 id，来自 `list()` / `get()`。基准里是 number，SDK 原样透传 */
  id: number | string
}

/** 页面「所属系统」下拉的候选（`app/portal/utils/define.js` 的 `SYSTEM_OPTIONS_ALL`） */
export const SYSTEM_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
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

/** 归一成字符串只用于**报错信息**与比较；发给后端的 id 保持调用方给的类型（见 `ContractTemplateRow.id`） */
function describeId (id: number | string): string {
  const value = typeof id === 'number' ? String(id) : id.trim()
  if (value === '') {
    throw new Error('合同模板 id 不能为空')
  }
  return value
}

/**
 * `status` 不属于这一页的参数契约。
 *
 * 页面**没有**一个控件绑定它（表单区只有「模板」和「类型」两项），浏览器发出的请求里
 * 从来没有它，所以 SDK 的列表能力也不开放它。两种"温和"的处理都不诚实：
 * 静默忽略 = 调用方以为筛过了；静默转发 = 在契约之外开一个来路不明的筛选条件
 * （后端 `ContractTemplatePageReqVO` 确实有 `status` 字段，但 `selectByPage` 的 XML
 * **没有**用它 —— 就算传了也筛不动，那更糟：是个看起来成功的空操作）。
 *
 * 按状态筛请用 `list` 拿到结果后自己过滤。
 */
export function assertNoStatusParam (query: unknown): void {
  if (query === null || typeof query !== 'object') return
  if (Object.prototype.hasOwnProperty.call(query, 'status')) {
    throw new Error(
      'status 不是「合同模板」的参数：页面没有任何控件绑定它，浏览器发出的请求里从来没有它，' +
        '后端 selectByPage 的 SQL 也不消费它（传了也筛不动）。' +
        '要按状态筛请先用 contract-template-list 取回列表再自行过滤。',
    )
  }
}

/**
 * `onlySubmit` 由 SDK 钉死成 1（「仅保存」）；传别的值的调用**当场拒绝**。
 *
 * `onlySubmit: 0` 是页面上的「保存并提交」：它会**真的发起一条 `contract_template` 审批流**，
 * 给真人推待办与通知。本页的写能力只允许碰自己创建的测试数据，而流程发出去就不再只碰自己了 ——
 * 所以这一支不做、也不测。详见文件头。
 *
 * 拒绝而不是静默改写成 1：调用方明确要求"发流程"时悄悄降级成"只存草稿"，
 * 会让它以为审批已经在走了。
 *
 * ## 判据为什么是 `!== 1` 而不是"存在就拒"
 *
 * 因为这条守卫会**走两遍**：门面的 `createIdempotent` 是
 * `send: (_params, { payload }) => create(payload)`（与班次管理那条线同构），
 * 送回来的正是 `buildTemplatePayload()` 的产物 —— 它**本来就带 `onlySubmit: 1`**。
 * 早先写成"存在即拒"时，冒烟第一步就被自己的载荷绊倒（`smoke/contract-template-crud.mjs`
 * 第一次运行就是这个红）。所以判据只能是"值不对才拒"。
 *
 * `startUserSelectAssignees` **不做守卫**：`buildTemplatePayload` 从不读它，
 * 输出里那个 `{}` 是常量。调用方传什么都不可能把审批人塞进去 ——
 * 与其加一条拦不住的假守卫，不如让测试锁住"传了也不进 body"。
 */
export function assertNoOnlySubmit (draft: unknown): void {
  if (draft === null || typeof draft !== 'object') return
  const record = draft as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(record, 'onlySubmit') && record.onlySubmit !== 1) {
    throw new Error(
      `onlySubmit 只能是 1（页面的「仅保存」），收到的是 ${JSON.stringify(record.onlySubmit)}。` +
        '传 0 会真的发起一条 contract_template 审批流、给真人推待办 —— ' +
        '本页的写能力只允许碰自己创建的数据，所以这一支不实现。',
    )
  }
}

/** 按契约里的**固定顺序**拼参数：调用方的实参顺序不影响 qs 序列化结果（D20） */
function buildListParams (query: ContractTemplateQuery): Record<string, unknown> {
  const provided = query as Record<string, unknown>
  const params: Record<string, unknown> = {}
  for (const item of LIST_QUERY) {
    const value = provided[item.name]
    params[item.name] = value === undefined ? item.defaultValue : value
  }
  return params
}

/**
 * `content` 的本地校验**只做后端无条件强制的那一层**。
 *
 * 后端 `ContractContentValidator.validateTemplateContent` 的第一段是：
 * 非空 → 是 JSON 对象 → `version` 是非空字符串 → `blocks` 是数组。这四条对任何模板都成立，
 * 挡在本地是省一次必然失败的写请求。
 *
 * **再深的规则不复制**（封面布局与字段上限、自动目录的层级、签署信息恰好两方、段落标题
 * H1-H4…）：那是前端 `validateTemplateConfig` 与后端校验器共同维护的一整套业务规则，
 * 在 SDK 里复刻一份会**两边各自漂移**，而且规则一变 SDK 就成了把合法请求挡在门外的那个。
 */
export function assertTemplateContent (content: unknown): asserts content is string {
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error(
      '模板内容 content 必填，且必须是 JSON **字符串**（不是对象）。' +
        `最省事的做法是抄一份现成的：list / get 返回的 content 原样传回，或直接用 EMPTY_TEMPLATE_CONTENT。`,
    )
  }
  let root: unknown
  try {
    root = JSON.parse(content)
  } catch {
    throw new Error(
      '模板内容 content 不是合法 JSON，后端会以「合同内容校验失败：JSON 格式不正确」拒绝整条写请求。',
    )
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('模板内容 content 的根节点必须是 JSON 对象（后端：「根节点必须是对象」）')
  }
  const record = root as Record<string, unknown>
  if (typeof record.version !== 'string' || record.version.trim() === '') {
    throw new Error('模板内容 content 的 version 必须是非空字符串（后端：「version 必须是非空字符串」）')
  }
  if (!Array.isArray(record.blocks)) {
    throw new Error('模板内容 content 的 blocks 必须是数组（后端：「blocks 必须是数组」）')
  }
}

/**
 * 构造新建 / 修改的请求体。
 *
 * **逐字段复刻页面 007 点「仅保存」时发出的 body**，包括键的书写顺序 —— D20 要求与浏览器
 * 发出的请求逐字段一致，键顺序不同也算不一致。基准：`baseline/contract-template.browser.json`
 * 第 5 / 6 条（实测
 * `{"typeId":13,"name":…,"useSystem":0,"onlySubmit":1,"content":"…","startUserSelectAssignees":{}}`
 * 与多了首键 `"id":77` 的 PUT 版本）。
 *
 * `id` 在 PUT body 里排**第一位**，因为页面的 `buildSubmitPayload` 是
 * `{...(hasRecord ? { id: bridge.record.id } : {}), typeId, name, useSystem, onlySubmit, content}`
 * —— 展开在前。
 */
export function buildTemplatePayload (draft: ContractTemplateDraft): Record<string, unknown> {
  if (draft.name === undefined || draft.name === null || String(draft.name).trim() === '') {
    throw new Error('模板名称必填（页面表单规则 required）')
  }
  if (draft.typeId === undefined || draft.typeId === null || String(draft.typeId).trim() === '') {
    throw new Error('模板类型 typeId 必填（页面表单规则 required）')
  }
  if (draft.useSystem === undefined || draft.useSystem === null) {
    throw new Error('所属系统 useSystem 必填（页面表单规则 required）')
  }
  assertTemplateContent(draft.content)

  // 键顺序原样照抄浏览器抓下来的 body
  return {
    typeId: draft.typeId,
    name: draft.name,
    useSystem: draft.useSystem,
    onlySubmit: 1,
    content: draft.content,
    startUserSelectAssignees: {},
  }
}

/** 修改的 body：`id` 在首位，其余同新建 */
export function buildTemplateUpdatePayload (draft: ContractTemplateUpdateDraft): Record<string, unknown> {
  return {
    id: draft.id,
    ...buildTemplatePayload(draft),
  }
}

const TEXT_TYPE_ID: ParamSpec = {
  name: 'typeId',
  kind: 'tree',
  required: true,
  description:
    '模板类型 id（分类字典 contract_type 的节点 id，例如 采购合同 = 13）。' +
    '页面用树选择器选它，且 `only-leaf`。SDK 不提供候选查询入口（见文档「尚未覆盖」）',
}

const DRAFT_PARAMS: ParamSpec[] = [
  TEXT_TYPE_ID,
  { name: 'name', kind: 'text', required: true, description: '模板名称' },
  {
    name: 'useSystem',
    kind: 'enum',
    required: true,
    description: '所属系统',
    options: SYSTEM_OPTIONS.map((item) => ({ label: item.label, value: item.value })),
  },
  {
    name: 'content',
    kind: 'text',
    required: true,
    description:
      '合同模板内容，**JSON 字符串**。抄现成模板最稳：list / get 返回的 content 原样传回；' +
      `也可以先用 EMPTY_TEMPLATE_CONTENT（${EMPTY_TEMPLATE_CONTENT}）建一个空壳`,
  },
]

export const LIST_PARAMS: ParamSpec[] = [
  {
    name: 'name',
    kind: 'text',
    required: false,
    description:
      '模板名称，**模糊匹配**（后端是 like）。改名后核对时新名字不能包含原名，否则原名也查得到',
  },
  {
    name: 'typeId',
    kind: 'tree',
    required: false,
    description:
      '模板类型 id，精确匹配。页面表单里叫「类型」；不传 = 不按类型筛',
  },
  { name: 'pageNo', kind: 'number', required: false, description: '页码，默认 1' },
  { name: 'pageSize', kind: 'number', required: false, description: `每页条数，默认 ${DEFAULT_PAGE_SIZE}` },
]

export const contractTemplateCapabilities: CapabilityDefinition[] = [
  {
    id: 'contract-template-list',
    title: '查询合同模板列表',
    pagePath: CONTRACT_TEMPLATE_PAGE_PATH,
    permission: CONTRACT_TEMPLATE_PERMISSION,
    write: false,
    params: LIST_PARAMS,
  },
  {
    id: 'contract-template-get',
    title: '查询单个合同模板',
    pagePath: CONTRACT_TEMPLATE_PAGE_PATH,
    permission: CONTRACT_TEMPLATE_PERMISSION,
    write: false,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '模板 id，来自 contract-template-list。列表接口本身就会返回 content，' +
          '只有拿单条（比如抄一份现成内容来改）时才需要它',
      },
    ],
  },
  {
    id: 'contract-template-create',
    title: '新建合同模板（仅保存，不发审批流）',
    pagePath: CONTRACT_TEMPLATE_PAGE_PATH,
    permission: CONTRACT_TEMPLATE_PERMISSION,
    write: true,
    params: DRAFT_PARAMS,
  },
  {
    id: 'contract-template-update',
    title: '修改合同模板（仅保存，不发审批流）',
    pagePath: CONTRACT_TEMPLATE_PAGE_PATH,
    permission: CONTRACT_TEMPLATE_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '模板 id，来自 contract-template-list。改之前先 contract-template-get 拿当前值 —— ' +
          '这个接口会把 status 按 onlySubmit 重写成 1（待提交），并把提交上去的四个字段整份写回',
      },
      ...DRAFT_PARAMS,
    ],
  },
  {
    id: 'contract-template-remove',
    title: '删除合同模板',
    pagePath: CONTRACT_TEMPLATE_PAGE_PATH,
    permission: CONTRACT_TEMPLATE_PERMISSION,
    write: true,
    params: [
      {
        name: 'id',
        kind: 'number',
        required: true,
        description:
          '模板 id。**逻辑删除**（`hr_contract_template.deleted` 置 1）。' +
          '⚠️ 有**关联合同**（`hr_contract.template_id` 指向它且 `deleted = 0`）时删不掉，' +
          '后端返回业务错误「存在关联合同，不能删除」',
      },
    ],
  },
]

/**
 * 能力实现。
 *
 * `request` 由 SDK 门面注入，已经带好页面上下文（module-type 走
 * `/dashboard/contract/template/list` 的推导结果 = 15 风险防控）。
 */
export function createContractTemplateCapability (request: PortalRequest) {
  return {
    /** 分页查询合同模板。只读 */
    list (query: ContractTemplateQuery = {}): Promise<PageResult<ContractTemplateRow>> {
      try {
        assertNoStatusParam(query)
      } catch (error) {
        // 参数错误一律走 Promise.reject，与 list 的其它校验、searchUsers 一致
        return Promise.reject(error)
      }
      return request<PageResult<ContractTemplateRow>>({
        url: '/hr/contract-template/page',
        method: 'get',
        params: buildListParams(query),
      })
    },

    /**
     * 单个合同模板详情。参数错误走 Promise.reject（`async` 保证）。
     *
     * `id` 走查询参数原样发（基准：`/hr/contract-template/get?id=77`），
     * 不做类型归一 —— 见 `ContractTemplateRow.id`。
     */
    async get (id: number | string): Promise<ContractTemplateRow> {
      describeId(id)
      return request<ContractTemplateRow>({
        url: '/hr/contract-template/get',
        method: 'get',
        params: { id },
      })
    },

    /**
     * 新建合同模板（**写操作**）。走的是页面的「仅保存」：`onlySubmit = 1`，**不起审批流**。
     *
     * 后端零幂等，重发一次就是两条 —— 所以门面上暴露的 `createIdempotent` 才是给 AI 用的
     * 那个（D12），这里保留无防重的原函数。
     *
     * 返回**新记录的 id**（后端 `CommonResult<Long>`，实测冒烟里返回了 `78`，
     * 与按名字查列表拿到的那条 id 一致）。⚠️ 与班次管理那条线**相反** ——
     * 那边的 `save` 返回空 Result、不回传 id。但"接口说成功"不算验证（D 系列）：
     * 要确认这条真的在，仍然要回 `list({ name })` 再查一次。
     * 名字是模糊匹配，用 `SDK-TEST-` 这种一眼能认出的前缀 + 时间戳可以避免撞上别人的数据。
     */
    async create (draft: ContractTemplateDraft): Promise<unknown> {
      assertNoOnlySubmit(draft)
      return request({
        url: '/hr/contract-template/create',
        method: 'post',
        data: buildTemplatePayload(draft),
      })
    },

    /**
     * 修改合同模板（**写操作**）。同样是「仅保存」那一支。
     *
     * 后端会**另插一条版本**（`version = 上一版 + 1`）并把模板行更新成提交上来的四个字段；
     * `status` 被按 `onlySubmit = 1` 重写成 **1（待提交）** —— 也就是说，改一个已经
     * 「已完成(4)」的模板会把它打回「待提交」。这是后端 `updateContractTemplate` 的
     * 既有行为（源码读出，**未实测**：造一条 status=4 的记录要先走完审批流）。
     *
     * 页面编辑态不是先 `GET /get`：列表的 `actionEdit(record)` 把整行塞进 bridge。
     * 所以浏览器发出的 PUT body 与 SDK 的结构一致（四个业务键 + id + onlySubmit +
     * startUserSelectAssignees），基准第 6 条可逐字段比对。
     */
    async update (draft: ContractTemplateUpdateDraft): Promise<unknown> {
      assertNoOnlySubmit(draft)
      return request({
        url: '/hr/contract-template/update',
        method: 'put',
        data: buildTemplateUpdatePayload(draft),
      })
    },

    /**
     * 删除合同模板（**写操作**）。
     *
     * 页面的行内「删除」有二次确认（气泡「确认删除？」），接口本身是
     * `DELETE /hr/contract-template/delete?id=` —— **id 走查询参数，没有请求体**
     * （与作业管理那条线不同：那边是 `DELETE` + body `["1071"]`）。
     *
     * ⚠️ **可能失败**：有 `hr_contract.template_id` 指向它且 `deleted = 0` 的合同时，
     * 后端返回业务错误「存在关联合同，不能删除」。SDK 不做预检查，如实透传这个失败。
     */
    async remove (id: number | string): Promise<unknown> {
      describeId(id)
      return request({
        url: '/hr/contract-template/delete',
        method: 'delete',
        params: { id },
      })
    },
  }
}

export type ContractTemplateCapability = ReturnType<typeof createContractTemplateCapability>

/**
 * 门面上带防重的那一层。与会议室 / 作业管理 / 班次管理同样的分工：`withIdempotency`
 * 需要**身份**，那是会话层的东西，所以包装放在组装点（`src/index.ts` / `src/server.ts`），
 * 不放进能力模块。
 *
 * 这里只声明"多了一个 requestId"的形状。
 *
 * 为什么**只有 create 需要**：见 `docs/pages/合同模板.md` 的写链路一节 —— `update` 是
 * 整份覆写、重发终态相同；`remove` 是逻辑删除、重复删后端返回成功。两条都是冒烟里
 * 原样重发验证过的。
 */
export type ContractTemplateCapabilityWithIdempotency = ContractTemplateCapability & {
  /**
   * 带短窗口防重的建模板（设计 D12）。`requestId` 由调用方生成并保管，
   * 超时重试时**原样传回上一次那个**（用 `createRequestId()` 生成）。
   */
  createIdempotent: (
    params: ContractTemplateDraft & { requestId: string },
  ) => Promise<unknown>
}
