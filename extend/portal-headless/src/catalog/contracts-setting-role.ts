import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SETTING_ROLE_METHODS, settingRoleCapabilities } from '../capabilities/setting-role.js'

const definitions = new Map(settingRoleCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const scopeFields: AiField[] = [
  field('moduleType', 'integer', '数据权限所属模块类型；来自Portal模块下拉，不是独立业务页面范围', { values: { '11': '组织管理', '12': '学习管理', '13': '绩效管理', '14': '薪酬管理', '15': '风险防控', '16': '审批管理', '23': '资金管理' } }),
  field('dataScopeType', '1 | 4 | 8 | 32 | 64 | 128', '数据权限范围：1所有权限、4自定义组织/班级、8所在部门及以下、32自定义标准化单元、64所在组织类型及以下、128所在法人'),
  field('organizationIdList', '(string | number)[]', '自定义组织、标准化单元或组织类型范围的ID；非适用范围归一为空数组'),
  field('gradeIdList', '(string | number)[]', '学习模块自定义班级范围ID；非学习模块通常为空数组'),
  field('legalPersonIdList', '(string | number)[] | undefined', '资金管理模块的手动法人范围；所有权限/所在法人或非资金模块时不发送，详情归一为空数组或缺省', { optional: true }),
]

const rowFields: AiField[] = [
  field('id', 'string | number', '角色ID；编辑、删除和岗位角色关联使用此ID'),
  field('name', 'string | null', '角色名称；null表示列表未返回名称', { nullable: true, nullMeaning: '后端未返回角色名称' }),
  field('roleIdentifier', 'string | null', '角色编码；页面展示但不作为权限码筛选', { nullable: true, nullMeaning: '后端未返回角色编码' }),
  field('remark', 'string | null', '角色备注；null表示后端未返回备注', { nullable: true, nullMeaning: '后端未返回备注' }),
  field('useSystem', 'integer | null', '角色所属系统值；只用于页面展示，不能据此宣称覆盖该系统根模块', { nullable: true, nullMeaning: '角色未绑定系统' }),
  field('createDate', 'string | number | null', '创建时间原值；SDK不转换时区', { nullable: true, nullMeaning: '后端未返回创建时间' }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页角色列表'), field('total', 'number', '符合名称筛选的角色总数，不是当前页长度'), ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[]且total=0表示当前筛选没有角色；权限、网络或响应形状错误会抛出，不能把空页解释成无权限。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: [
    field('id', 'string | number', '角色ID；编辑提交和删除使用此ID'),
    field('name', 'string', '角色名称；提交必填且不能全为空格，最多50个字符'),
    field('roleIdentifier', 'string | null', '角色编码；页面允许空值', { nullable: true, nullMeaning: '未填写角色编码' }),
    field('useSystem', 'integer | null', '系统下拉值；可为公共、人力、财务、资产、生产、采购、销售、科技、门户或平台等页面选项', { nullable: true, nullMeaning: '未选择系统' }),
    field('menuIdList', '(string | number)[]', '已授权菜单ID；菜单候选来自menuOptions，详情缺省归一为空数组'),
    field('remark', 'string | null', '角色备注；页面最多20个字符', { nullable: true, nullMeaning: '未填写备注' }),
    field('dataScope', 'integer | null', '角色旧版数据范围字段；Portal提交时强制为2，不能把详情值直接当作模块权限'),
    field('roleModuleDataScopeRelList', 'object[]', '按模块重建的数据权限关系；页面编辑时每个模块至多保留一行'),
    field('roleModuleDataScopeRelList[].moduleType', 'integer', '权限模块类型；只表示角色数据范围配置项'),
    field('roleModuleDataScopeRelList[].dataScopeType', 'integer', '该模块的数据范围类型'),
    ...scopeFields.slice(2).map(item => ({ ...item, path: `roleModuleDataScopeRelList[].${item.path}` })),
  ],
  empty: '缺少对象、角色ID或名称会抛出；不会把不存在的角色伪装成空表单。',
}

const treeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object[]', '树根节点数组'),
    field('[].id', 'string | number', '树节点ID；作为表单的菜单或组织范围ID'),
    field('[].name', 'string', '树节点名称'),
    field('[].children', 'object[]', '子节点；没有子节点时为空数组'),
  ],
  empty: '空数组表示当前会话没有返回候选；请求错误不会降级为空数组。',
}

const standardTreeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object[]', '标准化单元树根节点数组'),
    field('[].id', 'string | number', '标准化单元节点ID'),
    field('[].dictLabel', 'string', '标准化单元显示名称'),
    field('[].children', 'object[]', '子节点；没有子节点时为空数组'),
  ],
  empty: '空数组表示没有可用标准化单元；请求错误不会降级为空数组。',
}

const optionOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('[]', 'object[]', '候选项数组'), field('[].id', 'string | number', '候选项ID'), field('[].name', 'string', '候选项名称')],
  empty: '空数组表示当前会话没有候选；请求错误不会降级为空数组。',
}

const preparationOutput: AiContract['output'] = {
  shape: '{ mode: "create" | "update", draft: object, previous: object | null }',
  fields: [
    field('mode', '"create" | "update"', '表单模式'),
    field('draft', 'object', '完整角色保存草稿；尚未发送请求'),
    field('draft.id', '"" | string | number', '创建时复刻Portal初始id空字符串，编辑时为角色ID'),
    field('draft.name', 'string', '角色名称；非空且最多50个字符'),
    field('draft.roleModuleDataScopeRelList', 'object[]', '已按Portal规则规范化的模块数据权限关系'),
    field('draft.dataScope', '2', 'Portal提交时固定为2'),
    field('previous', 'object | null', '编辑prepare使用的原始详情；创建时为null'),
  ],
  empty: 'prepare只校验并生成内存草稿，不代表服务端已保存；取消时直接丢弃draft。',
}

const deletePreparationOutput: AiContract['output'] = {
  shape: '{ draft: { ids: (string | number)[] } }',
  fields: [field('draft.ids', '(string | number)[]', '待删除角色ID；至少一项，保持Portal批量删除数组语义')],
  empty: 'prepare只生成内存草稿，不会删除角色；取消时丢弃draft。',
}

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', 'Portal保存/删除成功包络没有业务返回值；Promise正常完成只表示请求完成')],
  empty: '请求抛错表示服务端未确认成功；不能从空返回推断角色详情或权限已生效。',
}

const evidence: AiContract['evidence'] = [
  { source: 'Portal test/portal/main@acab69acc77b6d6c0da21310cdfd26b91a01641e4：app/portal/menus/common.js、views/dashboard/hr/setting/role/list.vue、[mode]/[id].vue 及 hxr 选项组件', kind: 'reference', note: '核对页面权限、platform实例、pageSize分页、菜单/组织/标准单元/班级/法人候选、表单验证和提交归一化。' },
  { source: 'Java test/test@0f1a55718ebc1987affb8bf245106e809dd51da4：HrSysRoleController、SaveSysRoleDTO、SysRoleServiceImpl、HrRoleModuleDataScopeRelServiceImpl', kind: 'reference', note: '核对角色分页、详情、保存、删除、角色菜单和模块数据权限的服务端字段及级联删除。' },
  { source: 'src/capabilities/setting-role.ts 与 test/setting-role.test.ts', kind: 'implementation', note: '锁定SDK请求投影、表单校验、权限范围归一化、批量删除和错误反证。' },
  { source: 'docs/pages/角色管理.md', kind: 'reference', note: '记录本页四件套与实测边界。' },
]

const boundaries = [
  '只覆盖保留范围内的“系统设置 → 角色管理”页面（/dashboard/setting/role/list）及该页面实际加载的角色菜单、数据权限候选和角色增删改；独立生产、财务、资产、采购、销售、科技根模块页面不在本能力范围内。',
  '系统下拉和数据权限模块下拉确实包含生产等系统/模块值；这些值只是本页面角色权限配置的字段，不能据此宣称SDK实现了对应根模块业务页面。',
  '页面使用platform实例，页面规则没有可推导的module-type，SDK不发送module-type；调用仍受当前会话、租户、页面权限和后端数据范围控制，不能用permission字符串绕过权限。',
  '组织树、菜单树和标准化单元树由Portal无关键字全量加载；SDK复刻页面端点并严格校验树结构，但调用方不能把空结果解释为无权限，也不能把名称当ID。',
  '删除会级联删除用户-角色、菜单、数据权限、模块数据权限和岗位角色关系；页面没有撤销或恢复接口，提交前取消只能丢弃本地草稿。',
]

const definitionsById = (id: string) => {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`角色管理契约没有能力定义：${id}`)
  return definition
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitionsById(id)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: ['form', 'draft', 'current', 'changes'].includes(parameter.name) ? 'object' : parameter.kind === 'number' ? 'number' : parameter.name === 'ids' ? '(string | number)[]' : 'string | number | null',
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: 'Portal角色管理页面的筛选、详情、候选或用户明确表单输入；ID必须来自当前租户已核实结果。',
  }]))
}

const contracts: Record<string, AiContract> = {}
function add (id: string, value: Omit<AiContract, 'inputs'> & { inputs?: Record<string, AiParameter> }): void {
  definitionsById(id)
  contracts[id] = { ...value, inputs: { ...inputsOf(id), ...value.inputs } }
}

const base = (id: string, purpose: string, effect: AiContract['effect'], output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void => {
  add(id, {
    purpose,
    whenToUse: `当需要${purpose.replace(/[。；].*$/, '')}时使用本页能力。`,
    boundaries,
    effect,
    prerequisites: ['使用当前用户会话token、当前租户和角色管理页面权限；角色、菜单、组织、班级及法人ID必须来自当前租户可见且已核实的数据。'],
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? '请求完成后必须按角色ID重新读取详情或列表核对；不能只凭HTTP成功或空返回报告写入完成。' : '返回值符合本页字段契约；空候选和空列表按契约解释，不把请求错误降级为空。',
    failures: ['ID、表单校验、树结构、分页参数或响应形状错误按失败处理；403按当前页面/后端权限处理；写请求超时先回查，不能盲目重发。'],
    idempotency: effect === 'write' ? null : null,
    evidence,
    gaps: ['已完成Portal/Java源码核对和离线请求反证；尚未在真实测试环境执行本页读请求，也未执行角色保存/删除的真实prepare→submit→回查闭环。'],
    ...extra,
  })
}

base('setting-role-list', '查询角色分页', 'read', listOutput, [
  '按list[].id进入详情、编辑或批量删除；useSystem只作展示筛选语义，不能路由到对应系统根模块。',
  '请求固定带order=""、orderField=""、name、pageNo和pageSize；pageSize支持10、20、50、100，默认20。',
], { steps: [{ role: 'optional', when: '用户选择某个角色编辑', capabilityId: 'setting-role-get-info', mapping: { id: 'result.list[].id' }, instruction: '按同一角色ID读取完整详情，再合并明确修改。' }] })

base('setting-role-get-info', '读取角色编辑表单', 'read', detailOutput, [
  '详情返回的roleModuleDataScopeRelList已按页面编辑形态归一为数组；dataScopeType=128时三个范围列表为空，不能据此猜测原始组织范围。',
  'menuIdList、organizationIdList、gradeIdList和legalPersonIdList中的值是ID，不是名称；分别从菜单/组织/标准化单元/班级/法人候选取得显示名。',
], { inputs: { id: param('角色ID。', 'setting-role-list.list[].id 或调用方已核实的角色ID', { required: true, type: 'string | number' }) }, steps: [{ role: 'required', when: '用户确认编辑详情后修改', capabilityId: 'setting-role-prepare-update', mapping: { current: 'result.$' }, instruction: '把完整详情交给prepareUpdate，并把用户明确修改作为changes，不直接拼接更新请求。' }] })

base('setting-role-menu-options', '读取指定系统的角色菜单候选', 'read', treeOutput, [
  'useSystem必须来自Portal系统下拉；系统为空时页面不会请求此接口。菜单树中的id可放入角色草稿menuIdList。',
], { inputs: { useSystem: param('Portal系统下拉的整数值；不能传系统名称。', '角色编辑表单.useSystem', { required: true, type: 'number', constraints: ['只能是Portal系统选项值'] }) } })

base('setting-role-organization-tree', '读取角色数据权限组织树', 'read', treeOutput, [
  '页面在dataScopeType=4/64时使用这棵树；调用方只应把已选择节点id写入对应organizationIdList。',
], { gaps: ['Portal组件会一次性加载无界全量组织树；本次只完成离线结构核对，未测量线上树规模和真实权限裁剪。'] })

base('setting-role-standard-tree', '读取角色标准化单元树', 'read', standardTreeOutput, [
  '页面在dataScopeType=32时使用dictLabel显示名，提交只发送节点id。',
] )

base('setting-role-organization-type-options', '读取角色组织类型候选', 'read', optionOutput, [
  '页面在dataScopeType=64时使用；提交只发送候选id数组。',
])

base('setting-role-legal-person-options', '读取角色法人候选', 'read', optionOutput, [
  '页面仅在moduleType=23资金管理且dataScopeType=4时显示法人选择；其他模块的legalPersonIdList会被Portal删除。',
])

base('setting-role-grade-options', '读取角色班级候选', 'read', optionOutput, [
  '长选项调用必须先提供非空班级名称关键字；请求映射为后端name、pageNo和pageSize，学习模块dataScopeType=4提交时至少选择一个班级ID。',
], { gaps: ['Portal页面当前会一次性请求大页；无头SDK按约束收敛为关键字分页，真实环境候选数量和分页行为尚未实测。'] })

base('setting-role-prepare-create', '校验并准备新建角色表单', 'prepare', preparationOutput, [
  '新建草稿复刻Portal初始id=""，name非空且最多50个字符，remark最多20个字符且不能全为空格；提交固定dataScope=2。',
  '每个模块权限行的moduleType和dataScopeType必填且不能重复模块；学习模块只允许4/128，自定义范围需要对应的班级或组织ID。',
], { inputs: { form: param('新建角色表单；字段来自用户明确意图和本页候选。', '用户输入及setting-role-* options结果', { required: true, type: 'object' }) }, steps: [{ role: 'required', when: '用户确认新建', capabilityId: 'setting-role-create', mapping: { draft: 'result.draft' }, instruction: '只提交prepare返回的完整draft；成功或超时后按角色列表/详情回查。' }, { role: 'cancel', when: '用户在提交前取消新建', instruction: '丢弃draft，不调用服务端；页面没有新建撤销接口。' }], completion: '得到尚未写入服务端的完整角色保存草稿。', idempotency: null })

base('setting-role-create', '提交新建角色', 'write', voidOutput, [
  '请求严格使用POST /admin-api/sys/role/saveRoleV1；请求体来自prepareCreate，包含角色字段、菜单ID和模块数据权限关系，服务端会替换/创建所有关系。',
  '保存成功不会返回角色详情；必须重新list并按名称/角色ID取得详情，确认菜单和数据权限关系。',
], { inputs: { draft: param('setting-role-prepare-create返回的完整草稿。', 'setting-role-prepare-create.draft', { required: true, type: 'object' }), requestId: param('SDK本地短窗口防重键；不发送给Portal；同一创建意图超时重试复用原值。', '调用方用createRequestId()生成并保存', { required: true, type: 'string', constraints: ['同键不同草稿会被SDK拒绝', '进程重启或窗口过期不保证防重'] }) }, steps: [{ role: 'required', when: '保存成功或响应超时', capabilityId: 'setting-role-list', instruction: '重新查询角色列表取得新角色ID，再调用getInfo核对菜单和模块数据权限；响应不确定时先回查，不盲目重发。' }, { role: 'cancel', when: '用户在prepare阶段取消', instruction: '不调用create；已提交后没有Portal可达的撤销/恢复接口。' }], completion: '列表和详情回查确认角色及其权限关系后，才报告新建完成。', idempotency: 'invoke绑定settingRole.createIdempotent，在当前SDK进程、用户、租户和能力范围内按requestId及草稿指纹短窗口防重；requestId不进入Portal body。直接create不防重。' })

base('setting-role-prepare-update', '校验并准备编辑角色表单', 'prepare', preparationOutput, [
  '必须使用最新getInfo详情作为current；changes只覆盖用户明确修改的字段，提交仍是完整绝对值而非差异补丁。',
  '编辑草稿保留详情中Portal会继续发送的字段但移除parentId；dataScope仍强制为2，模块关系按Portal规则重建。',
], { inputs: { current: param('最新setting-role-get-info结果。', 'setting-role-get-info.result', { required: true, type: 'object' }), changes: param('用户明确要修改的角色表单字段；省略表示沿用current。', '用户编辑意图', { required: false, type: 'object', nullable: true }) }, steps: [{ role: 'required', when: '用户确认保存编辑', capabilityId: 'setting-role-update', mapping: { draft: 'result.draft' }, instruction: '只提交prepare返回的完整draft；保存后按同一角色ID回查。' }, { role: 'cancel', when: '用户在提交前取消编辑', instruction: '丢弃draft，不发送更新请求。' }], completion: '得到包含完整角色字段及模块权限、尚未写入的编辑草稿。', idempotency: null })

base('setting-role-update', '提交编辑角色', 'write', voidOutput, [
  '请求严格使用POST /admin-api/sys/role/updateRoleV1；角色名称重复会被后端拒绝，模块数据权限保存是先删旧关系再写新关系。',
  '成功或超时后必须按draft.id调用getInfo，逐字段核对name、menuIdList和roleModuleDataScopeRelList；不能用空返回代替回查。',
], { inputs: { draft: param('setting-role-prepare-update返回的完整草稿。', 'setting-role-prepare-update.draft', { required: true, type: 'object' }), 'draft.id': param('被编辑角色ID。', 'setting-role-prepare-update.draft.id', { required: true, type: 'string | number' }) }, steps: [{ role: 'required', when: '保存成功或响应超时', capabilityId: 'setting-role-get-info', mapping: { id: 'args.draft.id' }, instruction: '按同一ID读取详情并逐项比对；超时未确认前不要盲目重发。' }, { role: 'cancel', when: '用户在prepare阶段取消', instruction: '不调用update；已提交后没有Portal可达的撤销/恢复接口。' }], completion: 'getInfo回查与目标草稿一致后，才报告编辑完成。', idempotency: '后端没有requestId；这是关系全量替换，超时先回查，避免覆盖他人刚修改的权限。' })

base('setting-role-prepare-delete', '准备批量删除角色', 'prepare', deletePreparationOutput, [
  'ids必须是列表页已核实的一个或多个角色ID；prepare只校验ID，不发DELETE。',
], { inputs: { ids: param('待删除角色ID数组；至少一项。', 'setting-role-list.list[].id及用户明确选择', { required: true, type: '(string | number)[]' }) }, steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'setting-role-remove', mapping: { draft: 'result.draft' }, instruction: '只提交prepare返回的draft；成功后重新list确认这些ID不再出现。' }, { role: 'cancel', when: '用户在确认弹窗取消', instruction: '丢弃draft，不发送DELETE。' }], completion: '得到待删除ID数组的内存草稿。', idempotency: null })

base('setting-role-remove', '批量删除角色', 'write', voidOutput, [
  '请求严格使用DELETE /admin-api/sys/role，请求体是角色ID数组，不是{ids:[...]}对象；后端会级联删除用户角色、菜单、旧数据权限、模块数据权限和岗位角色关系。',
  '删除不可由页面撤销或恢复；成功或超时后必须重新list，必要时按ID查询确认级联关系已消失。',
], { inputs: { draft: param('setting-role-prepare-delete返回的删除草稿。', 'setting-role-prepare-delete.draft', { required: true, type: 'object' }) }, steps: [{ role: 'required', when: '删除成功或响应超时', capabilityId: 'setting-role-list', instruction: '重新查询列表确认目标ID已消失；不把HTTP成功替代为级联删除证据。' }, { role: 'cancel', when: '用户在prepare阶段取消', instruction: '不调用remove；一旦DELETE已发送，页面没有撤销接口。' }], completion: '列表回查确认目标角色不再可见后，才报告删除完成。', idempotency: '删除没有requestId；超时先回查，避免把不确定状态当作失败重发。' })

export const SETTING_ROLE_AI_CONTRACTS = contracts
export const SETTING_ROLE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_ROLE_METHODS).map(([id, method]) => [`settingRole.${method}`, { ...SETTING_ROLE_AI_CONTRACTS[id]!, boundaries: [...SETTING_ROLE_AI_CONTRACTS[id]!.boundaries, `直接方法使用sdk.settingRole.${method}；写操作仍必须遵循prepare→submit→回查，取消只丢弃未提交草稿。`] }]),
)
SETTING_ROLE_METHOD_CONTRACTS['settingRole.create'] = {
  ...SETTING_ROLE_METHOD_CONTRACTS['settingRole.create']!,
  inputs: Object.fromEntries(Object.entries(SETTING_ROLE_METHOD_CONTRACTS['settingRole.create']!.inputs).filter(([name]) => name !== 'requestId')),
  idempotency: '直接sdk.settingRole.create不防重；AI优先通过invoke("setting-role-create", { draft, requestId })使用createIdempotent。',
}
