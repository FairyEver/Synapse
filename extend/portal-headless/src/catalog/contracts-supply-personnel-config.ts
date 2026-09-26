import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SUPPLY_PERSONNEL_CONFIG_METHODS, supplyPersonnelConfigCapabilities } from '../capabilities/supply-personnel-config.js'

const definitions = new Map(supplyPersonnelConfigCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const rowFields: AiField[] = [
  field('id', 'string | number', '人员配置主键；列表行、详情、删除和编辑都使用这个 ID，Long 可能序列化为字符串'),
  field('legalId', 'string | number | null', '法人主体 ID；表单必选，来自本页法人组织树', { nullable: true, nullMeaning: '响应未关联法人；不能提交为合法新建值' }),
  field('legalName', 'string | null', '法人主体名称；用于展示，不能替代 legalId', { nullable: true, nullMeaning: '后端未返回名称' }),
  field('userId', 'string | number | null', '后端兼容字段；当前 Portal 表单不读取、不提交', { nullable: true, nullMeaning: '当前页面通常不使用' }),
  field('materielType', 'string | null', '后端保存的物料类型 ID 逗号字符串；SDK 同时归一化为 materielTypeIds', { nullable: true, nullMeaning: '未返回原始逗号字段' }),
  field('materielTypeIds', '(string | number)[]', '物料类型 ID 数组；每次新建/编辑至少一项，页面标签来自共享 materiel_type 字典'),
  field('materielTypeName', 'string | null', '物料类型展示名称；不能作为提交 ID', { nullable: true, nullMeaning: '后端未拼接名称' }),
  field('planUserId', 'string | null', '后端保存的计划人员 ID 逗号字符串；SDK 同时归一化为 planUserIds', { nullable: true, nullMeaning: '未返回原始逗号字段' }),
  field('planUserIds', '(string | number)[]', '计划人员 ID 数组；每次新建/编辑至少一项，ID 来自人员候选搜索'),
  field('planUserName', 'string | null', '计划人员展示名称；不能作为提交 ID', { nullable: true, nullMeaning: '后端未拼接名称' }),
  field('purchaseUserId', 'string | null', '后端保存的采购人员 ID 逗号字符串；SDK 同时归一化为 purchaseUserIds', { nullable: true, nullMeaning: '未返回原始逗号字段' }),
  field('purchaseUserIds', '(string | number)[]', '采购人员 ID 数组；每次新建/编辑至少一项，ID 来自人员候选搜索'),
  field('purchaseUserName', 'string | null', '采购人员展示名称；不能作为提交 ID', { nullable: true, nullMeaning: '后端未拼接名称' }),
  field('operatorName', 'string | null', '最后操作人名称；只读审计字段', { nullable: true, nullMeaning: '后端未返回操作人' }),
  field('createTime', 'string | number | null', '创建时间原值；SDK 不擅自转换时区', { nullable: true, nullMeaning: '后端未返回创建时间' }),
  field('updateTime', 'string | number | null', '更新时间原值；SDK 不擅自转换时区', { nullable: true, nullMeaning: '后端未返回更新时间' }),
]

const pageOutput = (label: string): AiContract['output'] => ({
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', label), field('total', 'number', '符合当前筛选条件的总记录数，不是当前页长度'), ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[] 表示当前页没有记录；total=0 才表示筛选条件下没有记录。权限、会话、网络或响应形状错误会抛出，不能降级为空页。',
})

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: rowFields,
  empty: '详情不是对象或缺少有效 id 会抛错；不能把空对象当作可编辑表单。',
}

const organizationTreeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[].id', 'string | number', '组织节点 ID；提交时只取用户选中的节点 ID'),
    field('[].name', 'string', '组织节点展示名称'),
    field('[].pid', 'string | number | null', '父组织节点 ID；null 表示根节点', { nullable: true, nullMeaning: '根节点或后端未返回父节点' }),
    field('[].isStandardUnit', 'number | boolean | null', '是否标准单位原码；与 isCorporation 任一为 1 时节点可选', { nullable: true, nullMeaning: '后端未返回该标记' }),
    field('[].isCorporation', 'number | boolean | null', '是否法人原码；与 isStandardUnit 任一为 1 时节点可选', { nullable: true, nullMeaning: '后端未返回该标记' }),
    field('[].disabled', 'boolean', 'Portal 的组织树禁用结果；true 表示 isStandardUnit!==1 且 isCorporation!==1，不能提交该节点'),
    field('[].children', 'object[]', '子组织节点，字段结构与当前节点相同'),
  ],
  empty: '[] 表示组织树没有节点；节点字段或权限响应错误会抛出，不能把禁用节点当作可选法人。',
}

const staffOutput = pageOutput('按关键字返回的人员候选分页')
staffOutput.fields = [
  field('list', 'object[]', '按员工姓名关键字命中的人员候选'),
  field('total', 'number', '后端报告的匹配总数，不是当前页长度'),
  field('list[].id', 'string | number', '员工主键；提交人员配置时使用此值'),
  field('list[].name', 'string', '员工姓名'),
  field('list[].staffCode', 'string | number | null', '员工工号；展示用，不能替代 id', { nullable: true, nullMeaning: '后端未返回工号' }),
  field('list[].status', 'number | null', '员工状态原码；只读', { nullable: true, nullMeaning: '后端未返回状态' }),
  field('list[].organization', 'string | number | null', '员工所属组织 ID；只读', { nullable: true, nullMeaning: '后端未返回组织' }),
  field('list[].label', 'string', 'Portal 选择器展示文本，格式为姓名(工号)；提交时仍使用 id'),
]
staffOutput.empty = 'list=[] 表示该关键字当前页无候选；调用必须提供非空 keyword，不能把空结果解释为无权限。'

const draftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('draft', 'object', '只包含 Portal 新建/编辑请求允许的字段；保存时不加入 userId 或 batchId'),
    field('draft.id', 'string | number', '编辑草稿的人员配置主键；新建草稿没有该字段', { optional: true }),
    field('draft.legalId', 'string | number', '法人主体 ID；来自可选组织节点'),
    field('draft.materielTypeIds', '(string | number)[]', '物料类型 ID 数组，至少一项'),
    field('draft.planUserIds', '(string | number)[]', '计划人员 ID 数组，至少一项'),
    field('draft.purchaseUserIds', '(string | number)[]', '采购人员 ID 数组，至少一项'),
  ],
  empty: '缺少法人或任一数组为空时准备阶段抛错，不生成半成品草稿。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '后端成功布尔回执；true 只表示请求完成，不代替写入回查')],
  empty: '没有 true 或请求抛错都不能报告操作成功；删除和编辑必须按后续步骤回查。',
}

const idOutput: AiContract['output'] = {
  shape: 'string | number',
  fields: [field('$', 'string | number', '新建后端返回的人员配置主键；保留原始类型避免长整数精度损失')],
  empty: '没有有效 ID 会抛错；不能把空回执当作已创建。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ bbcfc35154: app/portal/menus/supply.js、app/portal/views/dashboard/supply/setting/planner/list.vue、[mode]/[id].vue、组织树和人员选择组件', kind: 'reference', note: '逐页核对菜单路径/权限、列表默认分页与筛选、组织树可选条件、人员候选参数、表单必填规则、创建/编辑请求体和删除端点。' },
  { source: 'CodeReview_Mall_Platform_Java @ b7a359adc9e: LegalUserConfigController、LegalUserConfigSaveReqVO、LegalUserConfigRespVO、LegalUserConfigServiceImpl 及相关 Mapper', kind: 'reference', note: '核对 page/get/create/update/delete 端点、ID数组转CSV、三类数组非空限制、组织合法性和物料类型交叉校验。' },
  { source: 'src/capabilities/supply-personnel-config.ts 与 test/supply-personnel-config.test.ts', kind: 'implementation', note: '证明 SDK 最终请求参数、提交字段投影、ID/分页/组织树/候选响应校验和离线反证；不替代真实环境写入回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「供应链设置 → 人员配置」页面的列表、候选、表单和删除入口。',
  boundaries: [
    '页面权限是/dashboard/supply/setting/planner；所有业务请求使用 platform HTTP 实例，页面未推导出 module-type，SDK 不发送该头。',
    'materiel_type 选项来自 Portal 共享 platform 字典接口；SDK 不重复发布本页字典能力，调用方应使用已有 base-dict-search/base-dict-get。',
    'Portal 的人员选择器会无关键字循环拉取 /org/staff/page；SDK 不开放这个高风险全量入口，只提供必须带非空 keyword 且 pageSize 不超过100的 staffSearch，ID仍来自同一后端端点。',
    '表单只提交 legalId、materielTypeIds、planUserIds、purchaseUserIds；Portal 表单中的 batchId、后端兼容 userId 和展示名称不属于提交字段。',
  ],
  prerequisites: ['使用当前用户会话 token、当前租户和页面权限创建 SDK；legalId 必须来自组织树中 disabled=false 的节点，物料类型和人员 ID 必须来自已核实候选结果。'],
  failures: ['表单必填、候选关键字、组织可选性、后端物料类型交叉校验、权限、租户、网络或响应形状错误原样抛出；不能把空列表、true 或空回执解释成业务成功。'],
  evidence,
  gaps: ['已完成 Portal/Java 逐页静态核对与离线请求断言；尚未在真实测试环境执行本页浏览器读请求，也未执行真实写入的 prepare→submit→cancel/回查闭环。'],
})

const definitionsMap = new Map(supplyPersonnelConfigCapabilities.map(definition => [definition.id, definition]))
const inputsOf = (id: string): Record<string, AiParameter> => {
  const definition = definitionsMap.get(id)
  if (!definition) throw new Error(`Supply personnel config contract has no definition: ${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: parameter.name === 'pageNo' || parameter.name === 'pageSize' ? 'number' : parameter.name === 'id' ? 'string | number' : parameter.name === 'keyword' ? 'string' : parameter.name === 'legalId' ? 'string | number | null' : 'string',
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: '当前 Portal 人员配置页面的筛选、选择器或表单；按能力参数契约填写。',
  }]))
}

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Supply personnel config contract has no capability: ${id}`)
  contracts[id] = value
}

add('supply-personnel-config-list', base({
  purpose: '读取当前用户可见的人员配置分页列表，按法人和名称筛选。',
  effect: 'read',
  inputs: inputsOf('supply-personnel-config-list'),
  output: pageOutput('当前筛选的人员配置列表'),
  consume: ['按 total 和分页状态继续翻页；保留 list[].id 作为 get、编辑或删除目标。', 'list[].materielTypeName、planUserName、purchaseUserName 是展示名称，写入时仍使用对应 ID 数组。'],
  steps: [{ role: 'optional', when: '用户选择某行查看或编辑', capabilityId: 'supply-personnel-config-get', mapping: { id: 'result.list[].id' }, instruction: '先按列表行 id 读取完整详情，不要用展示名称拼回提交 ID。' }],
  completion: '返回当前筛选的一页和 total；读取成功不等于具有写权限。',
  idempotency: null,
}))

add('supply-personnel-config-get', base({
  purpose: '读取一个人员配置的完整编辑值和后端补充字段。',
  effect: 'read',
  inputs: inputsOf('supply-personnel-config-get'),
  output: detailOutput,
  consume: ['使用 legalId、materielTypeIds、planUserIds、purchaseUserIds 作为 prepareUpdate.current；展示名称仅展示，不代替 ID。', '响应中的 CSV 原字段和归一化后的 ID 数组保持可区分，不能把 CSV 直接当单个 ID。'],
  steps: [{ role: 'optional', when: '用户确认编辑', capabilityId: 'supply-personnel-config-prepare-update', mapping: { current: 'result.$' }, instruction: '只覆盖用户明确修改的四个表单字段；取消时丢弃草稿。' }],
  completion: '获得与 Portal customLoad 对齐的人员配置对象。',
  idempotency: null,
}))

add('supply-personnel-config-organization-tree', base({
  purpose: '读取 Portal 人员配置法人选择器使用的组织树，并标注可选节点。',
  effect: 'read',
  inputs: inputsOf('supply-personnel-config-organization-tree'),
  output: organizationTreeOutput,
  consume: ['只把 disabled=false 的节点 ID 作为 legalId；disabled=true 的父级/普通节点不能提交。', '树节点 ID 属于组织域，不要与人员 ID、部门树 ID 或法人名称混用。'],
  steps: [],
  completion: '交付递归组织树及与 Portal 相同的 disabled 结果。',
  idempotency: null,
}))

add('supply-personnel-config-staff-search', base({
  purpose: '按非空员工姓名关键字读取有限的人员配置候选，供计划人员和采购人员选择。',
  effect: 'read',
  inputs: { ...inputsOf('supply-personnel-config-staff-search'), keyword: param('必填且不能全为空格的员工姓名关键字；SDK 会 trim 后发送 staffName。', '用户明确输入的人员姓名搜索词', { type: 'string', required: true, constraints: ['不能为空或全空格', 'pageSize 最大100'] }) },
  output: staffOutput,
  consume: ['让用户从 list 中确认具体人员并保存 list[].id；label 仅为姓名(工号)展示文本。', '不要用空 keyword 拉全量人员；Portal 的无头安全限制是刻意收窄，不改变候选端点和 ID 语义。'],
  steps: [],
  completion: '返回关键字命中的有限人员候选页，且每行有可提交的 id。',
  idempotency: null,
}))

add('supply-personnel-config-prepare-create', base({
  purpose: '按 Portal 新建表单规则校验法人、物料类型、计划人员和采购人员，并生成新建草稿。',
  effect: 'prepare',
  inputs: { form: param('Portal 新建表单对象；包含 legalId、materielTypeIds、planUserIds、purchaseUserIds，四项均须由用户明确提供，后三项至少一项。', '用户填写的 Portal 人员配置表单；法人来自 organizationTree，物料类型来自 materiel_type 字典，人员来自 staffSearch', { type: 'object', required: true, constraints: ['legalId 为正整数 ID', 'materielTypeIds、planUserIds、purchaseUserIds 都是非空 ID 数组或 CSV 字符串'] }) },
  output: draftOutput,
  consume: ['提交前确认 legalId 对应 organizationTree 中 disabled=false 节点；确认三类数组都非空。', '用户取消时丢弃 draft，不调用 create。'],
  steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'supply-personnel-config-create', mapping: { draft: 'result.draft' }, instruction: '只提交准备结果；成功后用返回 ID 调用 get 或用列表回查。' }, { role: 'cancel', when: '用户取消新建', instruction: '丢弃 draft，不发 POST。' }],
  completion: '得到尚未写入的完整新建草稿。',
  idempotency: null,
}))

add('supply-personnel-config-create', base({
  purpose: '提交一个通过 Portal 表单规则的人员配置新建草稿。',
  effect: 'write',
  inputs: { draft: param('prepareCreate 返回的新建草稿；不能自行加入 userId、batchId 或展示名称。', 'supply-personnel-config-prepare-create.draft', { type: 'object', required: true }) },
  output: idOutput,
  consume: ['后端会再次校验三类 ID 非空、组织合法性和物料类型交叉关系；SDK 不把前端校验当作后端授权。', '成功或响应超时后先用返回 ID get，或按法人/人员条件 list 回查；不能只凭返回 ID 文本报告业务已生效。'],
  steps: [{ role: 'required', when: 'POST 完成或响应超时', capabilityId: 'supply-personnel-config-get', mapping: { id: 'result.$' }, instruction: '按返回 ID 回查详情，逐字段核对法人、物料类型、计划人员和采购人员。' }],
  completion: '返回有效 ID 且 get/list 回查确认目标配置出现。',
  idempotency: '后端没有 requestId；创建响应不确定时先按返回 ID 或唯一表单组合回查，未确认不存在前不要盲目重试。',
}))

add('supply-personnel-config-prepare-update', base({
  purpose: '基于最新详情和用户明确修改生成 Portal 人员配置编辑草稿。',
  effect: 'prepare',
  inputs: { current: param('最新 get 返回的完整详情，必须含 id 和四个可编辑字段。', 'supply-personnel-config-get', { type: 'object', required: true }), changes: param('只覆盖 legalId、materielTypeIds、planUserIds、purchaseUserIds；未修改字段保留 current，其他字段会抛错。', '用户明确编辑意图', { type: 'object', required: false, nullable: true }) },
  output: { ...draftOutput, shape: '{ draft: object, previous: object }', fields: [...draftOutput.fields, field('previous', 'object', '提交前完整草稿；取消时只丢弃 draft，不发 PUT')] },
  consume: ['编辑仍要求三类 ID 数组非空；Portal 的空选择不能被静默转换为保留旧值。', '用户取消时丢弃 draft；previous 只用于展示差异，不会自动写回。'],
  steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'supply-personnel-config-update', mapping: { draft: 'result.draft' }, instruction: '只提交完整 draft；成功或超时后按同一 id 回查详情。' }, { role: 'cancel', when: '用户取消编辑', instruction: '丢弃 draft，不发 PUT。' }],
  completion: '得到尚未写入的完整编辑草稿。',
  idempotency: null,
}))

add('supply-personnel-config-update', base({
  purpose: '提交一个通过 Portal 编辑规则的人员配置完整草稿。',
  effect: 'write',
  inputs: { draft: param('prepareUpdate 返回的完整草稿；必须含 id、legalId 和三类非空 ID 数组。', 'supply-personnel-config-prepare-update.draft', { type: 'object', required: true }) },
  output: trueOutput,
  consume: ['发送 PUT /admin-api/supply/legal-user-config/update；后端会重新执行组织与物料类型校验。', 'true 或响应超时后用同一 id get 逐字段回查；不把 true 当作返回后的完整记录。'],
  steps: [{ role: 'required', when: 'PUT 完成或响应超时', capabilityId: 'supply-personnel-config-get', mapping: { id: 'args.draft' }, instruction: '从已提交草稿对应的同一配置回查法人和三类 ID；回查前不要盲目重试。' }],
  completion: '请求返回 true 且详情回查确认目标字段一致。',
  idempotency: '后端没有 requestId；覆盖写超时先 get 回查，确认旧值仍在后才允许再次提交。',
}))

add('supply-personnel-config-remove', base({
  purpose: '删除列表中用户明确选定的一条人员配置。',
  effect: 'write',
  inputs: { id: param('人员配置主键 ID；必须来自当前列表或 get 的 id。', 'supply-personnel-config-list.list[].id 或 supply-personnel-config-get.id', { type: 'string | number', required: true }) },
  output: trueOutput,
  consume: ['Portal 删除前有确认步骤；SDK 调用本身不替用户确认。', 'true 或响应超时后重新 list，确认目标 ID 不再可见；不要只凭 true 判定删除已完成。'],
  steps: [{ role: 'required', when: 'DELETE 完成或响应超时', capabilityId: 'supply-personnel-config-list', instruction: '按同一筛选或目标 ID 回查列表，确认目标记录已消失。' }],
  completion: '请求返回 true 且列表回查确认目标 ID 不再可见。',
  idempotency: '后端没有 requestId；删除响应不确定时先 list 回查，不能盲目重复调用。',
}))

export const SUPPLY_PERSONNEL_CONFIG_AI_CONTRACTS = contracts
export const SUPPLY_PERSONNEL_CONFIG_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SUPPLY_PERSONNEL_CONFIG_METHODS).map(([id, method]) => [`supplyPersonnelConfig.${method}`, { ...SUPPLY_PERSONNEL_CONFIG_AI_CONTRACTS[id]!, boundaries: [...SUPPLY_PERSONNEL_CONFIG_AI_CONTRACTS[id]!.boundaries, '直接方法使用同名对象参数；写操作仍遵守 prepare→submit→回查，取消只发生在本地准备阶段。'] }]),
)
