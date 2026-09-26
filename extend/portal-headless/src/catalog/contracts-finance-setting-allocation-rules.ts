import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_ALLOCATION_RULE_TYPE, FINANCE_SETTING_ALLOCATION_RULES_METHODS } from '../capabilities/finance-setting-allocation-rules.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: false,
  nullable: false,
  ...extra,
})

const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning,
  source,
  required: true,
  ...extra,
})

const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, {
  required: false,
  omitted,
  ...extra,
})

const idRules = ['安全正整数或无前导零的正整数字符串', '长ID保留字符串，不能用名称、行号或租户ID代替']
const ruleTypeOptions = [
  { value: FINANCE_ALLOCATION_RULE_TYPE.CLASS, label: '费用类别分摊' },
  { value: FINANCE_ALLOCATION_RULE_TYPE.ORDER, label: '订单分配' },
]
const statusOptions = [{ value: 0, label: '停用' }, { value: 1, label: '启用' }]
const orderTypeOptions = [{ value: 1, label: '生产订单' }, { value: 2, label: '销售订单' }]

const costCenterFields = (prefix: string): AiField[] => [
  field(`${prefix}.id`, 'string | number', '成本中心主键；用于提交分配方/接收方ID', { constraints: idRules }),
  field(`${prefix}.code`, 'string', '成本中心编码原值', { nullable: true, nullMeaning: '后端未返回编码' }),
  field(`${prefix}.name`, 'string', '成本中心名称；只用于展示，不能代替id', { nullable: true, nullMeaning: '后端未返回名称' }),
  field(`${prefix}.unitId`, 'string | number', '成本中心所属单元ID', { nullable: true, nullMeaning: '后端未返回所属单元' }),
  field(`${prefix}.orgAttribute`, 'number', '成本中心组织财务属性；1表示生产成本，订单分配要求全部为1', { nullable: true, nullMeaning: '后端未返回组织财务属性' }),
  field(`${prefix}.orgIds`, 'array<string | number>', '成本中心关联组织ID数组；不是提交成本中心ID数组', { nullable: false }),
]

const rowFields = (prefix: string): AiField[] => {
  const base = prefix ? `${prefix}.` : ''
  return [
    field(`${base}id`, 'string | number', '费用分配规则主记录ID；详情和启停使用该值', { constraints: idRules }),
    field(`${base}status`, 'boolean', '当前绝对状态；true启用、false停用', { values: { true: '启用', false: '停用' } }),
    field(`${base}unitName`, 'string', '所属单元名称', { nullable: true, nullMeaning: '后端未解析所属单元名称' }),
    field(`${base}unitType`, 'string | number', '所属单元类型字典值；交给运行时字典解释', { nullable: true, nullMeaning: '后端未返回所属单元类型' }),
    field(`${base}ruleType`, 'string', '规则类型；cost_sharing_class为费用类别分摊，cost_sharing_order为订单分配', { nullable: true, values: { [FINANCE_ALLOCATION_RULE_TYPE.CLASS]: '费用类别分摊', [FINANCE_ALLOCATION_RULE_TYPE.ORDER]: '订单分配' } }),
    field(`${base}allocateCostCenters`, 'array<object>', '分配方成本中心快照；提交时只发送其中的id数组', { nullable: false }),
    ...costCenterFields(`${base}allocateCostCenters[]`),
    field(`${base}acceptCostCenters`, 'array<object>', '费用类别分摊的接收方成本中心快照；订单分配通常为空', { nullable: false }),
    ...costCenterFields(`${base}acceptCostCenters[]`),
    field(`${base}expenseType`, 'string', '费用类别字典值；费用类别分摊必填，候选来自expense_category中值以2开头的条目', { nullable: true, nullMeaning: '订单分配没有费用类别' }),
    field(`${base}expenseTypeName`, 'string', '费用类别显示名称', { nullable: true, nullMeaning: '后端未解析费用类别名称' }),
    field(`${base}indicator`, 'string | number', '分摊指标ID；交给运行时指标能力/标签解释', { nullable: true, nullMeaning: '后端未返回分摊指标' }),
    field(`${base}orderAllocationType`, 'number', '订单分配类型；1生产订单、2销售订单', { nullable: true, values: { '1': '生产订单', '2': '销售订单' }, nullMeaning: '费用类别分摊没有订单分配类型' }),
    field(`${base}ruleOrder`, 'number', '费用类别分摊顺序；范围1至10000', { nullable: true, nullMeaning: '订单分配没有费用分配顺序' }),
    field(`${base}productGroups`, 'string', '订单分配产品组ID逗号字符串；SDK不把它误解为产品组名称', { nullable: true, nullMeaning: '没有产品组限制' }),
    field(`${base}productGroupsName`, 'string', '订单分配产品组显示名称', { nullable: true, nullMeaning: '后端未解析产品组名称' }),
    field(`${base}description`, 'string', '规则描述；页面最多500字符', { nullable: true, nullMeaning: '后端未返回描述' }),
    field(`${base}updateTime`, 'string | number', '更新时间原值；SDK不擅自转换时区', { nullable: true, nullMeaning: '后端未返回更新时间' }),
    field(`${base}allocateOrg`, 'string', '后端分配方组织字段；页面不直接编辑，不能与成本中心ID混用', { nullable: true, nullMeaning: '后端未返回该字段' }),
    field(`${base}acceptOrg`, 'string', '后端接收方组织字段；页面不直接编辑', { nullable: true, nullMeaning: '后端未返回该字段' }),
    field(`${base}costCenterMigrationStatus`, 'number', '成本中心迁移状态；后端维护字段，页面只在响应中携带', { nullable: true, nullMeaning: '后端未返回迁移状态' }),
    field(`${base}costCenterMigrationMessage`, 'string', '成本中心迁移信息；不是保存成功标志', { nullable: true, nullMeaning: '后端未返回迁移信息' }),
  ]
}

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('$', 'object', '费用分配规则分页结果'),
    field('list', 'array', '当前页列表；不是全部匹配记录'),
    field('list[]', 'object', '一条页面列表行'),
    ...rowFields('list[]'),
    field('total', 'integer', '筛选后的总记录数；不是当前页长度', { constraints: ['非负整数'] }),
  ],
  empty: 'list=[]且total=0表示当前筛选没有记录；权限、网络或响应形状失败会抛错，不改写为空列表。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: [field('$', 'object', '费用分配规则详情'), ...rowFields('')],
  empty: '详情必须包含可识别的id、ruleType、分配方成本中心和页面消费字段；缺失字段抛错。',
}

const draftFields: AiField[] = [
  field('$', 'object', '尚未写入的费用分配规则草稿'),
  field('draft', 'object', '提交给create或update的业务字段'),
  field('draft.id', 'string | number', '编辑时的规则主记录ID；创建时没有此字段', { optional: true, nullable: false, constraints: idRules }),
  field('draft.status', 'boolean', '保存时的绝对状态；创建固定为true，编辑沿用current.status'),
  field('draft.ruleType', 'string', '规则类型', { values: { [FINANCE_ALLOCATION_RULE_TYPE.CLASS]: '费用类别分摊', [FINANCE_ALLOCATION_RULE_TYPE.ORDER]: '订单分配' } }),
  field('draft.allocateCostCenterIds', 'array<string | number>', '分配方成本中心ID数组；至少一项且不重复', { constraints: ['每个ID保留原始字符串或安全整数'] }),
  field('draft.acceptCostCenterIds', 'array<string | number>', '费用类别分摊接收方成本中心ID数组；至少一项；订单分配发送[]'),
  field('draft.expenseType', 'string', '费用类别分配字典值；费用类别分摊必填且必须以2开头，订单分配为null', { nullable: true, nullMeaning: '订单分配不使用费用类别' }),
  field('draft.indicator', 'string | number', '分摊指标ID', { constraints: idRules }),
  field('draft.orderAllocationType', 'number', '订单分配类型；1生产订单、2销售订单，类别分摊为null', { nullable: true, values: { '1': '生产订单', '2': '销售订单' } }),
  field('draft.ruleOrder', 'number', '类别分摊顺序；1至10000，订单分配为null', { nullable: true }),
  field('draft.productGroups', 'string', '订单分配产品组ID逗号字符串；类别分摊为空字符串', { nullable: false }),
  field('draft.description', 'string', '规则描述；最多500字符'),
]

const statusOutput: AiContract['output'] = {
  shape: '{ draft: { id, status }, previous: { id, status } }',
  fields: [
    field('$', 'object', '启停目标草稿和操作前快照'),
    field('draft', 'object', '提交给setStatus的绝对目标状态'),
    field('draft.id', 'string | number', '规则主记录ID', { constraints: idRules }),
    field('draft.status', 'boolean', '绝对目标状态；true启用、false停用'),
    field('previous', 'object', '操作前状态快照；可用于显式恢复'),
    field('previous.status', 'boolean', '操作前绝对状态'),
  ],
  empty: 'targetStatus与当前status相同或字段非法时抛错，不产生草稿。',
}

const listInputs: Record<string, AiParameter> = {
  unitIdList: optional('所属单元ID数组', '页面所属单元树选择器', '发送[]，不限制所属单元', { type: 'array<string | number>', constraints: idRules }),
  allocateCostCenterIdList: optional('分配方成本中心ID数组', '页面成本中心（分配方）多选', '发送[]，不限制分配方', { type: 'array<string | number>', constraints: idRules }),
  acceptCostCenterIdList: optional('接收方成本中心ID数组', '页面成本中心（接收方）多选', '发送[]，不限制接收方', { type: 'array<string | number>', constraints: idRules }),
  expenseTypeIdList: optional('费用类别字典值数组', '页面expense_category运行时字典中值以2开头的多选项', '发送[]，不限制费用类别', { type: 'array<string | number>' }),
  ruleType: optional('规则类型', '页面顶部voucher_rule_type切换', '默认cost_sharing_class费用类别分摊', { type: 'string', options: ruleTypeOptions }),
  indicator: optional('分摊指标ID', '页面分摊指标选择器', '发送null，不限制分摊指标', { type: 'string | number', nullable: true, constraints: idRules }),
  status: optional('列表状态筛选：0停用、1启用', '页面状态单选', '默认发送数值1即启用', { type: 'integer', options: statusOptions }),
  pageNo: optional('从1开始的页码', '调用方分页状态', '默认1', { type: 'integer', constraints: ['正整数'] }),
  pageSize: optional('当前页条数', '调用方分页状态', '默认20；页面支持10、20、50、100', { type: 'integer', constraints: ['只能取10、20、50、100'] }),
}

const createInputs: Record<string, AiParameter> = {
  ruleType: input('规则类型；决定分支字段和后端校验', '用户在规则类型选择器的值', { type: 'string', options: ruleTypeOptions }),
  allocateCostCenterIds: input('分配方成本中心ID数组', '用户在成本中心树选择器的值', { type: 'array<string | number>', constraints: ['至少一项且不能重复', ...idRules] }),
  acceptCostCenterIds: optional('费用类别分摊接收方成本中心ID数组', '费用类别分摊表单的接收方选择器', '订单分配发送[]；类别分摊不能省略或为空', { type: 'array<string | number>', constraints: ['类别分摊至少一项且不能与分配方重叠'] }),
  orderAllocationType: optional('订单分配类型：1生产订单或2销售订单', '订单分配表单的订单分配类型', '类别分摊发送null', { type: 'integer', options: orderTypeOptions, nullable: true }),
  expenseType: optional('费用类别字典值', '类别分摊表单expense_category中值以2开头的选项', '订单分配发送null；分配方有生产成本属性时只能是29空舍费', { type: 'string | number', nullable: true, constraints: ['类别分摊必填；值以2开头'] }),
  indicator: input('分摊指标ID', '页面分摊指标选择器', { type: 'string | number', constraints: idRules }),
  ruleOrder: optional('费用分配顺序', '类别分摊表单数字输入', '订单分配发送null', { type: 'integer', nullable: true, constraints: ['类别分摊必填，1至10000'] }),
  productGroups: optional('产品组ID数组或逗号字符串', '订单分配表单产品组多选', '类别分配发送空字符串', { type: 'array<string | number> | string', nullable: true }),
  description: input('规则描述', '页面文本域', { type: 'string', constraints: ['去首尾空白后非空', '最多500字符'] }),
  allocateCostCenters: optional('已核实的分配方成本中心快照', '当前成本中心选择器返回的对象；用于提前复现组织财务属性业务规则', '不提供时保留后端校验；订单分配若提供快照则全部必须为生产成本属性', { type: 'object[]', nullable: true }),
}

const updateInputs: Record<string, AiParameter> = {
  current: input('get或list返回的最新完整规则行', 'finance-setting-allocation-rules-get结果或list.list[]', { type: 'object' }),
  changes: optional('用户明确修改的表单字段', '用户确认的编辑差异', '沿用current对应字段', { type: 'object' }),
}

const draftInput = (source: string): AiParameter => input('prepare返回的完整保存草稿；不要手写或删除字段', source, { type: 'object' })

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:f61fdca151 app/portal/menus/finance.js 与 app/portal/views/dashboard/finance/setting/allocation-rules.vue', kind: 'reference', note: '证明菜单路径、页面权限和列表/详情路由；不是浏览器网络实测。' },
  { source: 'CodeReview_Projects_Js@test/portal/main:f61fdca151 app/portal/views/dashboard/finance/setting/allocation-rules/list.vue、[mode]/[id].vue、detail/[id].vue、common/libs/renren/list.js', kind: 'reference', note: '证明页面默认筛选、数值状态、分页、按钮权限、端点、表单载荷、重复预检、成本中心组织财务属性校验和详情字段。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:7aeaca409d5 ExpenseAllocationRuleController、PageReqVO、SaveReqVO、RespVO、ServiceImpl、ExpenseAllocationRuleCostCenterValidator', kind: 'reference', note: '证明分页/详情/创建/更新/启停端点、载荷字段、Long ID、后端唯一性和成本中心业务规则；不是部署环境实测。' },
  { source: 'src/capabilities/finance-setting-allocation-rules.ts', kind: 'implementation', note: '证明SDK页面上下文、参数校验、Portal重复预检、保存载荷和返回投影；不替代真实环境验证。' },
  { source: 'test/finance-setting-allocation-rules.test.ts', kind: 'test', note: '离线夹具锁定逐页静态证据、默认参数、表单分支、重复预检、启停补偿、坏响应和AI关键字段反证；测试不发真实网络。' },
]

const boundaries = [
  '能力只覆盖Portal“财务设置→费用分配规则”列表、详情、新建/编辑表单和行内启停；页面moduleType按页面推导为null，不发送module-type头。',
  '列表状态筛选严格复现Portal发送的数值0/1；列表返回的status是后端Boolean，启停请求发送Boolean绝对值，不能把两种线上的类型混为一谈。',
  '保存前先按Portal发起page?pageSize=999重复预检，再调用create或update；重复预检不是后端事务，超时后必须按ID回查，不能盲目重试。',
  '成本中心名称、组织名称和字典标签是展示字段；提交只发送成本中心ID、分摊指标ID、费用类别值等业务字段。长ID保留字符串。',
  '页面没有删除或取消写入接口；prepare的previous只能用于显式恢复编辑前草稿或启停前状态，不是假定存在事务回滚。',
  'SDK允许通过allocateCostCenters快照提前复现页面组织财务属性校验；未提供快照时不伪造组织属性，仍由后端最终裁决。',
]

const failures = [
  'ID、成本中心数组、规则类型、分支字段、指标、顺序或描述不合法时在发请求前失败；不要用名称或行号替代ID。',
  '页面响应缺少list/total、详情字段或写入非true/合法ID时抛错；不能把HTTP成功、空对象或false当作业务成功。',
  '重复规则、成本中心重叠、组织财务属性不满足、权限不足或后端校验失败原样暴露；刷新最新详情后再修正，不放宽断言。',
  '写请求超时结果不确定：创建按返回ID或规则条件回查，编辑/启停按同一ID回查；没有页面可达的删除/取消接口。',
]

function contract (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract {
  return {
    whenToUse: '操作Portal“财务设置→费用分配规则”页面的查询、详情、创建、编辑和启停动作。',
    boundaries,
    prerequisites: ['已建立带有效会话token与tenantId的platform SDK；页面菜单和按钮权限由Portal/后端裁决。', '写入前保留prepare返回的draft/previous，并确认当前行没有被其他人修改。'],
    failures,
    evidence,
    gaps: ['未启动浏览器，未取得真实网络基准，也未在测试环境执行逐页读请求或prepare→submit→cancel写闭环；本契约基于固定Portal/Java源码和离线测试。', '页面没有可达删除/取消接口，新建成功后的清理不能由SDK安全代办；实际权限、部署字典和响应变体仍需真实环境验证。'],
    ...value,
  }
}

export const FINANCE_SETTING_ALLOCATION_RULES_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-allocation-rules-list': contract({
    purpose: '按页面筛选和分页读取费用分配规则列表，保留后续详情、编辑和启停所需的完整行字段。',
    effect: 'read',
    inputs: listInputs,
    output: pageOutput,
    consume: ['用list和total渲染当前页；status是Boolean，ruleType决定费用类别分摊/订单分配字段含义。', '保留同一行完整id和status；需要写入前先get刷新详情，不能用名称或当前页序号定位。'],
    steps: [
      { role: 'optional', when: '用户查看规则详情', capabilityId: 'finance-setting-allocation-rules-get', mapping: { id: 'result.list[].id' }, instruction: '用当前行id读取详情。' },
      { role: 'optional', when: '用户新建规则', capabilityId: 'finance-setting-allocation-rules-prepare-create', mapping: {}, instruction: '收集页面分支字段后先准备草稿，再由用户确认写入。' },
      { role: 'optional', when: '用户编辑规则', capabilityId: 'finance-setting-allocation-rules-prepare-update', mapping: { current: 'result.list[]' }, instruction: '使用最新完整行，不只传显示名称。' },
    ],
    completion: '返回当前筛选条件下的严格分页结果；list为空是业务空结果，不是权限或网络错误。',
    idempotency: null,
  }),
  'finance-setting-allocation-rules-get': contract({
    purpose: '读取详情页展示和编辑表单需要的费用分配规则完整字段。',
    effect: 'read',
    inputs: { id: input('费用分配规则主记录ID', 'list.list[].id或已确认的详情ID', { type: 'string | number', constraints: idRules }) },
    output: detailOutput,
    consume: ['根据ruleType解释分支字段；用allocateCostCenters/acceptCostCenters中的id生成编辑表单数组。', '把indicator、expenseType等ID/字典值交给对应候选或字典能力解释，不把name字段提交回去。'],
    steps: [],
    completion: '获得可用于展示或prepareUpdate的完整详情。',
    idempotency: null,
  }),
  'finance-setting-allocation-rules-prepare-create': contract({
    purpose: '按Portal新建表单校验和规则分支生成无副作用保存草稿。',
    effect: 'prepare',
    inputs: createInputs,
    output: { shape: '{ draft: FinanceAllocationRuleSaveDraft }', fields: draftFields, empty: '非法分支字段、ID、成本中心、指标或描述会抛错，不返回半成品draft。' },
    consume: ['费用类别分摊要求接收方、费用类别、规则顺序；订单分配要求订单分配类型，并将接收方置为[]、费用类别置为null。', '若提供成本中心快照，订单分配的分配方必须全部为orgAttribute=1；类别分配存在生产成本分配方时expenseType必须为29。'],
    steps: [{ role: 'required', when: '用户确认新建', capabilityId: 'finance-setting-allocation-rules-create', mapping: { draft: 'result.draft' }, instruction: '只提交prepare返回的draft；create会先执行Portal同样的重复规则预检。' }],
    completion: '生成可交给create且尚未发网络请求的草稿。',
    idempotency: null,
  }),
  'finance-setting-allocation-rules-create': contract({
    purpose: '创建一条费用分配规则并启用它。',
    effect: 'write',
    inputs: { draft: draftInput('finance-setting-allocation-rules-prepare-create.result.draft') },
    output: { shape: 'string | number', fields: [field('$', 'string | number', '新创建规则主记录ID；不是成本中心ID或指标ID', { constraints: idRules })], empty: '后端未返回合法ID时抛错。' },
    consume: ['保存返回ID；随后get同一ID核对规则类型、成本中心、状态和分支字段，不能只凭HTTP成功。'],
    steps: [
      { role: 'required', when: '创建返回ID后确认落库', capabilityId: 'finance-setting-allocation-rules-get', mapping: { id: 'result.$' }, instruction: '用返回的主记录ID回查详情，核对status=true和用户确认的字段。' },
      { role: 'cancel', when: '创建失败、超时或用户要求撤销', instruction: '页面和SDK没有删除/取消接口；先按规则条件回查确认是否已写入，不能伪造cancel或盲目重复创建。' },
    ],
    completion: '后端返回合法ID且回查确认新规则已按预期启用。',
    idempotency: '没有requestId或SDK幂等包装；重复预检只降低重复风险，不是并发唯一性保证。超时先回查，未确认前不要重发。',
  }),
  'finance-setting-allocation-rules-prepare-update': contract({
    purpose: '基于最新详情/列表行合并用户明确变更，复现Portal编辑表单规则并生成保存草稿。',
    effect: 'prepare',
    inputs: updateInputs,
    output: { shape: '{ draft: FinanceAllocationRuleSaveDraft & { id }, previous: FinanceAllocationRuleSaveDraft & { id } }', fields: [...draftFields, field('previous', 'object', '编辑前完整草稿；用于人工补偿而非事务回滚'), field('previous.id', 'string | number', '编辑前同一规则ID', { constraints: idRules })], empty: 'current缺字段或changes包含不支持的字段时抛错。' },
    consume: ['changes只填写用户明确修改的ruleType、成本中心、分支字段、指标、顺序、产品组、描述或status；未填写字段沿用current。', '保留previous；更新超时先get同一ID判断最终状态，不要直接把previous当作已回滚。'],
    steps: [{ role: 'required', when: '用户确认保存编辑', capabilityId: 'finance-setting-allocation-rules-update', mapping: { draft: 'result.draft' }, instruction: '只提交draft；update会先执行Portal重复预检并发送最小SaveReqVO字段。' }],
    completion: '生成带同一规则ID的可提交draft和操作前快照，未发网络请求。',
    idempotency: null,
  }),
  'finance-setting-allocation-rules-update': contract({
    purpose: '更新一条已有费用分配规则。',
    effect: 'write',
    inputs: { draft: draftInput('finance-setting-allocation-rules-prepare-update.result.draft') },
    output: { shape: 'boolean', fields: [field('$', 'boolean', '后端更新成功标志；只接受true', { values: { true: '更新成功' } })], empty: 'false或其它回执抛错。' },
    consume: ['返回true后用draft.id重新get，核对成本中心ID集合、规则分支字段、描述和status；不要把true当作字段已落库的唯一证据。'],
    steps: [
      { role: 'required', when: '更新返回true或超时后确认终态', capabilityId: 'finance-setting-allocation-rules-get', mapping: { id: 'context.draft.id' }, instruction: '回查同一规则ID并核对最终字段。' },
      { role: 'recovery', when: '用户明确要恢复且previous来自同一规则ID', capabilityId: 'finance-setting-allocation-rules-update', mapping: { draft: 'context.previous' }, instruction: '把previous作为新的update草稿提交；这是显式补偿，不是事务回滚。' },
    ],
    completion: '后端返回true且回查确认同一ID达到预期字段。',
    idempotency: '没有requestId或SDK幂等包装；超时先回查同一ID，不能盲目重复更新。',
  }),
  'finance-setting-allocation-rules-prepare-set-status': contract({
    purpose: '根据最新规则行和用户明确的绝对目标状态生成启停草稿及恢复快照。',
    effect: 'prepare',
    inputs: { current: input('最新完整列表行或详情行', 'finance-setting-allocation-rules-list.list[]或get结果', { type: 'object' }), targetStatus: input('绝对目标状态：true启用或false停用；必须与current.status相反', '用户明确的启用/停用意图', { type: 'boolean', constraints: ['不能传toggle或与current.status相同'] }) },
    output: statusOutput,
    consume: ['确认draft.status是用户明确目标后交给setStatus；previous只作为需要恢复时的显式输入。'],
    steps: [{ role: 'required', when: '用户确认启停', capabilityId: 'finance-setting-allocation-rules-set-status', mapping: { draft: 'result.draft' }, instruction: '提交绝对draft，不要根据旧值在调用方再次toggle。' }],
    completion: '产生无副作用的目标状态载荷和操作前快照。',
    idempotency: null,
  }),
  'finance-setting-allocation-rules-set-status': contract({
    purpose: '把费用分配规则设置为绝对启用或停用状态。',
    effect: 'write',
    inputs: { draft: draftInput('finance-setting-allocation-rules-prepare-set-status.result.draft') },
    output: { shape: 'boolean', fields: [field('$', 'boolean', '后端状态更新成功标志；只接受true', { values: { true: '更新成功' } })], empty: 'false或其它回执抛错。' },
    consume: ['成功后按draft.id重新get核对status；启用还会触发后端唯一性和业务校验，失败应保留原状态。'],
    steps: [
      { role: 'required', when: '启停返回true或超时后确认终态', capabilityId: 'finance-setting-allocation-rules-get', mapping: { id: 'context.draft.id' }, instruction: '回查同一ID，不要按列表第一行认领结果。' },
      { role: 'recovery', when: '用户明确恢复操作前状态且previous来自同一条记录', capabilityId: 'finance-setting-allocation-rules-set-status', mapping: { draft: 'context.previous' }, instruction: '把previous作为绝对状态再次提交；这不是事务回滚。' },
    ],
    completion: '后端返回true且回查确认同一ID达到目标status。',
    idempotency: '绝对状态重复提交通常收敛，但没有requestId；超时仍须先按同一ID回查。',
  }),
}

export const FINANCE_SETTING_ALLOCATION_RULES_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_ALLOCATION_RULES_METHODS).map(([id, method]) => [`financeSettingAllocationRules.${method}`, FINANCE_SETTING_ALLOCATION_RULES_AI_CONTRACTS[id]!]),
)
