import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  HR_TRANSFER_IN_PLAN_METHODS,
  hrTransferInPlanCapabilities,
} from '../capabilities/hr-transfer-in-plan.js'

const definitions = new Map(hrTransferInPlanCapabilities.map(definition => [definition.id, definition]))

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: true,
  nullable: true,
  ...extra,
})

const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning,
  source,
  required: false,
  ...extra,
})

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main app/portal/menus/hr.js 与 app/portal/views/dashboard/hr/org/transfer-in-plan/list.vue、detail/[id].vue', kind: 'reference', note: '逐页核对菜单路径、权限、组织树请求、年度/组织筛选、已审批状态、任职要求弹窗和简历库路由。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test RecruitmentPlanController、RecruitmentPlanPageReqVO、RecruitmentPlanRespVO、RecruitmentPlanServiceImpl、HrOrganizationController、HrPostController、HrPostDTO', kind: 'reference', note: '核对分页参数、status=2、组织数据范围、岗位原始DTO字段和响应形状。' },
  { source: 'src/capabilities/hr-transfer-in-plan.ts 与 test/hr-transfer-in-plan.test.ts', kind: 'implementation', note: '锁定页面上下文、请求参数顺序语义、可达本地路由和岗位字段原样返回。' },
]

const gaps = [
  '本轮已完成固定 Portal/Java 检出与离线夹具核对，并尝试打开真实测试环境；当前会话停留在登录页，未取得或读取凭据，尚未读取真实组织树、计划列表或岗位详情。',
  '列表页的总人数与组织子树聚合是Portal组件内的展示计算；SDK交付原始组织树和分页行，调用方必须按组织ID递归聚合，不能把当前页total当作人数合计。',
]

const planOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '招聘计划分页响应；详情页和概览页都只取已审批计划', { nullable: false }),
    field('list', 'object[]', '当前请求条件下的招聘计划行数组；Portal用它展示表格或按组织树聚合', { nullable: false }),
    field('list[].id', 'string | number', '招聘计划 ID；简历库路由必须使用这个ID，不能用postId或organizationId代替', { nullable: false, constraints: ['正整数或正整数字符串'] }),
    field('list[].title', 'string | null', '招聘计划标题'),
    field('list[].recruitmentType', 'number | null', '招聘类型；保持后端数值，不把它当作审批状态'),
    field('list[].recruitmentTypeName', 'string | null', '招聘类型展示名称'),
    field('list[].planYear', 'number | null', '计划年份；四位年份，不是到岗日期'),
    field('list[].organizationId', 'string | number | null', '计划所属组织 ID；概览聚合按它与组织树节点ID的字符串值匹配', { constraints: ['正整数或正整数字符串'] }),
    field('list[].organizationName', 'string | null', '计划所属组织名称'),
    field('list[].organizationFullPath', 'string | null', '计划所属组织全路径；详情表优先展示它'),
    field('list[].postId', 'string | number | null', '计划岗位 ID；存在时可下钻postRequirement'),
    field('list[].postName', 'string | null', '计划岗位名称'),
    field('list[].postTypeName', 'string | null', '计划岗位类别名称'),
    field('list[].planNumber', 'number | null', '调入人数；Portal显示为人数，聚合时空值按0处理，但SDK不改写原始空值'),
    field('list[].purpose', 'string | null', '招聘计划用途'),
    field('list[].requirementText', 'string | null', '计划自身的岗位要求文本；岗位详情接口失败或缺少字段时作为Portal弹窗兜底'),
    field('list[].salaryLevelMin', 'string | number | null', '薪资等级范围下限ID；不是金额'),
    field('list[].salaryLevelMax', 'string | number | null', '薪资等级范围上限ID；不是金额'),
    field('list[].salaryRangeName', 'string | null', '薪资范围展示文本；不自行换算为金额'),
    field('list[].urgency', 'string | null', '紧急程度展示值'),
    field('list[].arrivalDate', 'string | null', '到岗日期原始字符串；不把它当作计划年份'),
    field('list[].remark', 'string | null', '计划备注'),
    field('list[].status', 'number | null', '审批状态；本页请求固定传2，2表示已审批，1/3/4分别表示审批中/已驳回/已取消'),
    field('list[].statusName', 'string | null', '审批状态展示名称'),
    field('list[].processInstanceId', 'string | null', '审批流程实例ID；只作流程关联标识，不等于招聘计划ID'),
    field('list[].creator', 'string | number | null', '创建人ID'),
    field('list[].createTime', 'string | null', '创建时间原始值'),
    field('list[].updater', 'string | number | null', '更新人ID'),
    field('list[].updateTime', 'string | null', '更新时间原始值'),
    field('total', 'number', '后端分页总条数；不是Portal整体情况卡片的人数合计', { nullable: false, constraints: ['非负整数'] }),
  ],
  empty: 'list=[]表示条件下没有已审批计划；不要据此断言组织树为空或用户没有权限。',
}

const treeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('$', 'object[]', '当前会话在调入计划页面可见的角色组织树', { nullable: false }),
    field('[].id', 'string | number', '组织节点ID；聚合和详情筛选使用它，保留长ID原始字符串', { nullable: false, constraints: ['正整数或正整数字符串'] }),
    field('[].pid', 'string | number | null', '父组织ID'),
    field('[].name', 'string | null', '组织名称；列表和组织筛选展示文本'),
    field('[].fullPath', 'string | null', '组织全路径（后端返回时保留）'),
    field('[].children', 'object[]', '直接下级组织节点；递归按相同字段解释，空数组表示没有下级'),
  ],
  empty: '[]表示当前会话返回空的角色组织范围；不要把它解释为全租户组织不存在。',
}

const postOutput: AiContract['output'] = {
  shape: 'object',
  fields: [
    field('$', 'object', 'GET /org/hrpost/{id}返回的岗位原始DTO；缺少postId或后端返回空值时SDK返回{}', { nullable: false }),
    field('id', 'string | number | null', '岗位ID'),
    field('name', 'string | null', '岗位名称'),
    field('status', 'number | null', '岗位状态；后端说明0未使用、1正在使用'),
    field('isDel', 'number | null', '删除标志；0未删除、1已删除'),
    field('gender', 'number | null', '岗位性别要求；后端DTO值0男、1女、2无要求'),
    field('salaryLevelMin', 'string | number | null', '薪资等级下限ID；不是金额'),
    field('salaryLevelMax', 'string | number | null', '薪资等级上限ID；不是金额'),
    field('postType', 'string[] | number[] | null', '岗位类别ID数组'),
    field('postTypeName', 'string | null', '岗位类别名称'),
    field('postTypeNameList', 'string[] | null', '岗位类别名称数组'),
    field('postAssignment', 'string | null', '岗位定责'),
    field('educationalRequirement', 'string | null', '后端原始学历要求字段；不要改名为Portal模板中的educationRequirement'),
    field('experienceRequirement', 'string | null', '经历要求；Portal模板按此语义展示'),
    field('abilityRequirement', 'string | null', '能力要求；Portal模板按此语义展示'),
    field('remark', 'string | null', '岗位备注'),
  ],
  empty: '{}表示没有postId、岗位响应为空或后端未返回对象；Portal此时继续使用计划行的postName/postTypeName/requirementText兜底展示。',
}

const detailRouteOutput: AiContract['output'] = {
  shape: '{ path: string }',
  fields: [
    field('$', 'object', '调入计划详情页路由准备结果', { nullable: false }),
    field('path', 'string', '固定为/dashboard/org/transfer-in-plan/detail/{组织ID}；没有组织ID时末段为0'),
  ],
  empty: '不会返回空路由；非法ID在本地校验阶段失败。末段0是Portal整体情况按钮的真实占位，不代表组织ID为0。',
}

const resumeRouteOutput: AiContract['output'] = {
  shape: 'null | { path: string }',
  fields: [
    field('$', 'null | object', '简历库路由准备结果；Portal行没有招聘计划ID时不跳转并对应null'),
    field('path', 'string', '固定为/dashboard/staff/recruitment-plan/resume/{招聘计划ID}'),
  ],
  empty: 'null表示Portal的goResume因缺少record.id直接返回；不表示简历库查询为空。',
}

function base (id: string, purpose: string, effect: AiContract['effect'], output: AiContract['output'], inputs: Record<string, AiParameter>, consume: string[], steps: AiContract['steps'] = []): AiContract {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`调入计划契约缺少能力定义：${id}`)
  return {
    purpose,
    whenToUse: purpose,
    effect,
    boundaries: [
      '只覆盖提示词保留范围内的 hr/人力 → 组织管理 → 调入计划页面及其页面实际可达的招聘计划详情/岗位要求/简历库路由；不扩展到独立顶级生产、财务、采购、销售或科技页面。',
      '列表和详情请求固定筛选status=2（已审批），本节点不提供招聘计划新建、审批、撤销、删除、简历上传或面试写入能力；简历库这里只准备Portal既有路由。',
      '组织可见性由当前会话、租户、角色组织数据范围和module-type=11决定；SDK不把空树、空列表或岗位接口失败解释成权限结论。',
    ],
    prerequisites: ['使用带有效会话token、租户和当前页面上下文的SDK；组织ID和招聘计划ID必须来自同一页面响应或用户确认的真实ID。'],
    inputs,
    output,
    consume,
    steps,
    completion: effect === 'local' ? '返回与Portal页面路由动作一致的本地结果，不改变服务器数据。' : '返回当前会话、筛选条件下的原始页面数据；调用方按Portal页面规则展示或继续下钻。',
    failures: ['响应形状不符合页面实际结构时抛错，不返回空数组或空分页冒充成功；会话、权限和网络错误交由调用方处理。', 'ID、年份和本地路由参数非法时在发请求或拼路由前失败。'],
    idempotency: null,
    evidence,
    gaps,
  }
}

export const HR_TRANSFER_IN_PLAN_AI_CONTRACTS: Record<string, AiContract> = {
  'hr-transfer-in-plan-organization-tree': base(
    'hr-transfer-in-plan-organization-tree',
    '读取调入计划页面组织筛选器实际使用的角色组织树。',
    'read',
    treeOutput,
    {},
    ['将节点按name展示；用户选定节点后，把节点id传给detail，并用同一棵树递归计算页面整体情况和子组织调入人数。', '不要把组织名称、数组下标或生产专用组织树ID当作本页面组织ID。'],
  ),
  'hr-transfer-in-plan-overview': base(
    'hr-transfer-in-plan-overview',
    '读取调入计划列表页当前年份、已审批状态的计划原始分页。',
    'read',
    planOutput,
    {},
    ['与organizationTree结果按organizationId做字符串匹配；对当前节点及其递归下级的planNumber求和，空值按0参与Portal卡片/行展示。', 'total只是后端总条数，不能直接当作调入人数。'],
    [{ role: 'optional', when: '用户点击整体情况或叶子组织进入详情', capabilityId: 'hr-transfer-in-plan-prepare-detail', mapping: { id: 'user.selectedOrganizationId' }, instruction: '用组织节点ID准备详情路由；未选择组织时传空得到末段0。' }],
  ),
  'hr-transfer-in-plan-detail': base(
    'hr-transfer-in-plan-detail',
    '按当前组织和年份读取调入计划详情表的已审批计划。',
    'read',
    planOutput,
    {
      organizationId: input('当前详情页组织ID；传null复现Portal路由0或未选组织的请求。', 'hr-transfer-in-plan-organization-tree返回节点的id；不要传组织名称。', { type: 'string | number | null', nullable: true, nullMeaning: '不限制组织ID' }),
      planYear: input('计划年份；传YYYY字符串或四位数字，省略默认为当前年，显式null复现清空年份后的Portal请求。', 'Portal详情页a-date-picker的年份值经formatDay(..., "YYYY")后的值。', { type: 'string | number | null', nullable: true, format: 'YYYY', nullMeaning: '不传年份筛选' }),
    },
    ['按organizationFullPath/organizationName与postName展示组织岗位；按planNumber、salaryRangeName、urgency和arrivalDate展示原始值，不把薪资等级ID换算为金额。', '点击任职要求时使用行postId调用postRequirement；点击简历库/上传简历时使用行id调用prepareResume。'],
    [
      { role: 'optional', when: '用户打开详情行的任职要求弹窗且行有postId', capabilityId: 'hr-transfer-in-plan-post-requirement', mapping: { postId: 'result.list[].postId' }, instruction: '以postId读取岗位原始DTO；弹窗字段必须区分后端educationalRequirement与Portal模板的educationRequirement拼写。' },
      { role: 'optional', when: '用户点击简历库或上传简历', capabilityId: 'hr-transfer-in-plan-prepare-resume', mapping: { id: 'result.list[].id' }, instruction: '传招聘计划行id，不传postId；返回null时保持Portal不跳转。' },
    ],
  ),
  'hr-transfer-in-plan-post-requirement': base(
    'hr-transfer-in-plan-post-requirement',
    '读取详情行岗位ID对应的岗位任职要求原始DTO。',
    'read',
    postOutput,
    { postId: input('岗位ID；没有postId时省略，SDK不发请求并返回空对象。', 'hr-transfer-in-plan-detail返回行的postId。', { type: 'string | number', nullable: true, constraints: ['正整数或正整数字符串'] }) },
    ['优先使用后端原始字段：gender、educationalRequirement、experienceRequirement、abilityRequirement；Portal模板中的genderRequirement、educationRequirement和postRequirement不是SDK新增别名。', '岗位接口返回空对象时，用详情行postTypeName、postName和requirementText复现Portal兜底展示。'],
  ),
  'hr-transfer-in-plan-prepare-detail': base(
    'hr-transfer-in-plan-prepare-detail',
    '准备调入计划列表页进入详情页的路由。',
    'local',
    detailRouteOutput,
    { id: input('组织节点ID；允许省略以复现整体情况按钮的0占位路由。', 'hr-transfer-in-plan-organization-tree返回的节点id或Portal整体情况动作。', { type: 'string | number | null', nullable: true }) },
    ['在支持Portal路由的宿主中打开path；path末段0只表示未选组织的页面占位，不代表真实组织。', '该动作不读取详情、不提交招聘计划，也不代表页面导航已经成功。'],
  ),
  'hr-transfer-in-plan-prepare-resume': base(
    'hr-transfer-in-plan-prepare-resume',
    '准备详情页“简历库”或“上传简历”按钮实际使用的招聘计划简历库路由。',
    'local',
    resumeRouteOutput,
    { id: input('招聘计划ID；详情页两个按钮都传record.id，缺少时Portal直接不跳转。', 'hr-transfer-in-plan-detail返回行的id；不能使用postId。', { type: 'string | number | null', nullable: true }) },
    ['在支持Portal路由的宿主中打开path；进入后简历读取、上传和写操作属于招聘计划简历库页面，不由本节点代替。', '返回null时保持Portal不跳转，并要求先取得有效招聘计划ID。'],
  ),
}

export const HR_TRANSFER_IN_PLAN_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(HR_TRANSFER_IN_PLAN_METHODS).map(([capabilityId, method]) => [
    `hrTransferInPlan.${method}`,
    {
      ...HR_TRANSFER_IN_PLAN_AI_CONTRACTS[capabilityId]!,
      boundaries: [...HR_TRANSFER_IN_PLAN_AI_CONTRACTS[capabilityId]!.boundaries, `这是公开门面 sdk.hrTransferInPlan.${method}；需要交给能力调度时使用对应 capabilityId。`],
    },
  ]),
)
