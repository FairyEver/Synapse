import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PERF_MANAGE_STANDARD_PAGE_PATH,
  perfManageConfigCapabilities,
} from '../capabilities/perf-manage-config.js'

/**
 * 标准详情页「使用标准岗位」候选树的 AI 契约（`perf-manage-standard-role-post-tree`）。
 *
 * 控件源码：`app/portal/views/dashboard/hr/manage/standard/components/post-select.vue`
 * （唯一调用点），由 `standard/[mode]/[id].vue` 渲染的
 * `standard/standard-data.vue:33-38` 挂上去。
 *
 * 本文件是自包含的，由主线统一接线进 `src/catalog/ai-contracts.ts` ——
 * 与 `contracts-study-course.ts`、`contracts-perf-analysis-department-detail.ts` 同一形态。
 *
 * ⚠️ 这一页里另外两段组织树写法在源码中是**注释掉的**（`standard-data.vue:20-31`）：
 * 旧的 `component-organization-select` 与 `portal-hxr-tree-select-role-org` 都指
 * `/org/organization/getRoleOrganizationTree`。页面里生效的是最后那一版
 * （注释写着「4月22日长建让改成这个」），按项目规则注释掉的不进 SDK。
 */

const definitions = new Map(
  perfManageConfigCapabilities.map(definition => [definition.id, definition]),
)

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: false,
  nullable: false,
  ...extra,
})

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning,
  source,
  required: true,
  ...extra,
})

const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter =>
  param(meaning, source, { required: false, omitted, ...extra })

const contracts: Record<string, AiContract> = {}

function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`标准岗位树契约没有对应的能力定义：${id}`)
  contracts[id] = value
}

add('perf-manage-standard-role-post-tree', {
  purpose: '查询标准详情页「使用标准岗位」的多选树候选：当前角色可见的组织，以及挂在组织下的岗位节点。',
  whenToUse:
    '在标准管理里新建/编辑一条标准、要填「使用标准岗位」时才用。' +
    '与同页那个被注释掉的角色组织树（/org/organization/getRoleOrganizationTree）不是一回事，' +
    '也与 base-dept-search 那种纯部门树不是一回事 —— 这个接口的节点里混着**岗位**。',
  boundaries: [
    '返回的是**一棵树**（后端 TreeUtils.build，组织节点在上、岗位节点挂在其下），不是扁平清单；SDK 不摊平、不重排、不裁字段。',
    '后端的 id 有两种来源：组织节点的 id 是真组织 id，**岗位节点的 id 是后端把“组织 id”和“岗位 id”当字符串拼出来的合成值**（HrOrganizationServiceImpl:3466）。它只服务树组件回显，不能当任何实体的主键。',
    '只有带 orgPostId 的节点可选（页面 disabled: !item.orgPostId）；组织节点只用于分组与路径，选它没有落库意义。',
    '提交时落库的是 **orgPostId**（→ 保存草稿的 orgPostIdList），不是节点 id：节点 id 进的是 orgTreeIdList，只用于回显。两者不能互换。',
    '页面只把空串当 roleId 发出去（Spring 绑成 null ⇒ 按当前登录用户的角色算范围）；本能力暴露 roleId，但正常调用不该传它。',
    '这一页保存 DTO 里的 organizationList 字段仍然存在，但页面已经不用它了（组织选择器的两版写法都被注释掉）；不要拿本能力的返回值去填 organizationList。',
  ],
  effect: 'read',
  prerequisites: [
    '使用当前用户会话与租户创建 SDK；该用户对 /dashboard/manage/standard 有权限。',
    '调用前先有目标标准的 formState（新建时 id 为空、编辑时有 id），本能力只解决「使用标准岗位」这一个字段的候选。',
  ],
  inputs: {
    roleId: optional(
      '角色 id；省略即按当前登录用户的角色。',
      '用户显式指定要看哪个角色的可见范围时提供；正常情况下不提供（与页面一致）',
      'SDK 发送空字符串，与页面完全一致；后端把空串绑成 null ⇒ 按当前登录用户的角色算范围',
      {
        type: 'string | number',
        constraints: [
          '页面从不传它（post-select.vue 的 roleId 默认空串，standard-data.vue 用组件时也没传），本 SDK 没有为它建候选入口。',
          '传了就换了范围：树里会是那个角色的可见组织，不代表当前用户自己有权限操作这些岗位。',
        ],
      },
    ),
  },
  output: {
    shape: 'object[]（树：根节点数组，每层的 children 再挂下一层；不是分页包络）',
    fields: [
      field('$', 'object[]', '树的根节点数组；组织节点在上，岗位节点挂在其所属组织的 children 里。'),
      field('id', 'string | number', '节点 id。组织节点是真组织 id；**岗位节点是后端拼接的合成 id**（organizationId 与 postId 直接相连），只用于树组件回显（orgTreeIdList）。', {
        optional: true,
        nullable: true,
        nullMeaning: '后端未返回节点 id',
        constraints: ['不要用它作为任何实体主键，也不要拿它去填 orgPostIdList —— 那要用 orgPostId。'],
      }),
      field('organizationId', 'string | number', '组织 id：组织节点上是自己，岗位节点上是它所属的组织。', { optional: true, nullable: true, nullMeaning: '后端未返回组织 id' }),
      field('postId', 'string | number', '岗位 id；**只有岗位节点有**。', { optional: true, nullable: true, nullMeaning: '组织节点没有岗位 id（这是区分两类节点的可靠判据之一）' }),
      field('orgPostId', 'string | number', 'hr_organization_post 主键；**只有岗位节点有**，是页面的“可选”判据，也是要提交给 orgPostIdList 的值。', {
        optional: true,
        nullable: true,
        nullMeaning: '组织节点没有这一项（页面据此把节点置为不可选）',
        source: 'HrOrganizationPostService.getOrgPostList(组织id列表) 返回的主键',
      }),
      field('name', 'string | null', '节点名称：组织名或岗位名。', { optional: true, nullable: true, nullMeaning: '后端未返回名称' }),
      field('pid', 'string | number | null', '上级节点 id。组织节点指向上级组织；岗位节点指向它所属的组织。', {
        optional: true,
        nullable: true,
        nullMeaning: '根节点没有上级（后端未设置时该键可能缺席或为 null）',
      }),
      field('children', 'array', '子节点数组。**叶子是空数组而不是缺席**（后端 TreeNode.children 的初值就是 new ArrayList<>()）。', {
        optional: true,
        nullable: true,
        nullMeaning: '后端未返回该字段（与空数组不同：缺席说明响应形状变了）',
      }),
      field('children[]', 'object', '一个子节点，结构与根节点相同（同 id/organizationId/postId/orgPostId/name/pid/children），可继续向下嵌套。', { optional: true }),
    ],
    empty:
      '[] 表示当前角色的数据范围里没有任何可见组织（页面此时是空树，选不了岗位）；' +
      '有组织但一个岗位都没配时，根节点仍在、只是各层 children 为空数组。请求失败会抛错，不会降级成空数组。',
  },
  consume: [
    '按层读取：先看根节点，再用 children 下钻；页面用的是同一棵树（它自己 flatTree 后按 id 找节点）。',
    '判断某节点能不能选：**有 orgPostId 才能选**（页面 disabled: !item.orgPostId）。组织节点没有 orgPostId，只用于分组与路径。',
    '把用户选中的岗位节点**取出 orgPostId**（不是 id）组成 perf-manage-standard-prepare-save-data 的 orgPostIdList；同一批节点的 id 组成 orgTreeIdList 用于回显。两组 id 不能互换。',
    '空数组与「children 为空数组」是两种不同的空：前者说明没有可见组织，后者说明某组织下没有岗位；不要把它们都说成“没有岗位”。',
  ],
  steps: [
    {
      role: 'optional',
      when: '用户已经在这棵树上选定了岗位节点、要回到标准详情页继续填表单',
      capabilityId: 'perf-manage-standard-prepare-save-data',
      mapping: {
        orgPostIdList: 'result.orgPostId',
        orgTreeIdList: 'result.id',
      },
      instruction:
        '先由用户选定节点，再分两步取两个不同的值（本能力的返回根就是节点数组，下面两个字段是**逐节点**取的）：' +
        'orgPostIdList = 所选岗位节点的 orgPostId（**不是 id**，组织节点没有这个值、不能选）；' +
        'orgTreeIdList = 同一批节点的 id（用于回显）。除了这两个授权字段，其余表单字段（id/name/standardType/unit/header/dataList 等）必须沿用当前详情页已有内容，' +
        '本能力不产生它们；prepare 只是本地校验，不写服务端。',
    },
  ],
  completion:
    '交付当前角色可见的组织岗位树，以及「哪些节点可选、选了之后哪两个值分别填哪个字段」的规则；' +
    '查询本身不修改标准，也不代表用户已经选定 —— 选定与保存分别由用户确认和 perf-manage-standard-save-data 完成。',
  failures: [
    '会话/权限错误原样抛出；不要用空树代替失败，也不要因为树是空的就断定用户没有岗位 —— 先核对角色范围与组织配置。',
    '返回结构没有 children、或节点里既没有 orgPostId 也没有 pid 这类形状变化时，说明接口契约变了，停止按本说明解析并重新核对。',
    '本能力是只读 GET：重试不会产生副作用，但重复调用会整棵重拉，不要放进循环里按节点调。',
  ],
  idempotency: null,
  evidence: [
    {
      source: 'CodeReview_Projects_Js@test/portal/main:6ac274fc9e app/portal/views/dashboard/hr/manage/standard/components/post-select.vue、standard-data.vue:20-38，以及 app/portal/components/portal/hxr/tree-select/role-org/index.vue（对照那段被注释掉的写法）',
      kind: 'reference',
      note: '核对唯一调用点、roleId 默认空串且组件调用处没传、fieldNames 取 name/id/children、disabled 判据与 onTreeChange 取 orgPostId 写进 orgPostIdList；同时确认该页另外两版组织树的写法处于注释状态、不属于生效路径。未覆盖：没有浏览器基准，也没有真实响应样本。',
    },
    {
      source: 'CodeReview_Mall_Platform_Java@test/test:77fbc2a206c HrOrganizationController:413、HrOrganizationServiceImpl:3443-3472、OrganizationPostDTO、framework.common.util.TreeNode、TreeUtils.build',
      kind: 'reference',
      note: '核对端点路径、参数绑定（Long roleId，空串绑成 null）、组织与岗位两类节点各自被赋了哪些字段、岗位节点 id 的拼接规则、children 由 TreeUtils 按 pid 组装且初值为空数组。固定检出静态证据，不代表该提交已部署到测试环境。',
    },
    {
      source: 'src/capabilities/perf-manage-config.ts',
      kind: 'implementation',
      note: '锁定能力 id、方法名、roleId 缺省即发空串的请求形状与不做任何投影的返回。',
    },
  ],
  gaps: [
    '没有浏览器基准、也没有在真实测试环境执行过；请求形状与节点字段来自前端与 Java 源码的静态推导。',
    '这棵树的真实体量未测量（组织数 × 岗位数），所以没有做本地关键字过滤或限量 —— 与该页其它两个组织树端点的体量都无法横向比较。',
    'roleId 传非空值时后端按该角色算范围的行为只有源码依据，未实测；页面本身也没有这个入口。',
  ],
})

export const PERF_MANAGE_STANDARD_ROLE_POST_TREE_CONTRACTS: Record<string, AiContract> = contracts

// 这一页的 pagePath 必须与能力定义一致 —— 契约与定义分叉时，describe(页面) 会指向错页。
if (![...definitions.values()].some(definition =>
  definition.id === 'perf-manage-standard-role-post-tree' &&
  definition.pagePath === PERF_MANAGE_STANDARD_PAGE_PATH)) {
  throw new Error('标准岗位树能力没有登记在标准管理页上；契约与能力定义已分叉')
}
