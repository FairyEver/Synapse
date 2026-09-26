import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALARY_PACKAGE_METHODS, salaryPackageCapabilities } from '../capabilities/salary-package.js'

const definitions = new Map(salaryPackageCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const packageFields: AiField[] = [
  field('id', 'string | number', '薪资账套ID；Java Long 可能序列化为字符串，后续编辑、复制、删除和项目查询必须原样保留'),
  field('name', 'string | null', '账套名称；Portal表单必填且最多50个字符', { nullable: true }),
  field('organizationId', 'string | number | null', '所属组织ID；不是组织名称', { nullable: true }),
  field('organizationName', 'string | null', '所属组织显示名称；只用于表单展示和Portal整表提交', { nullable: true }),
  field('type', 'string | null', '所得项目类型字典值', { nullable: true }),
  field('countRange', 'string | null', '薪资计税区间字典值', { nullable: true }),
  field('roleIdList', '(string | number)[]', '授权角色ID数组；服务端按当前用户角色授权账套范围返回/保存', { optional: true }),
]

const itemFields: AiField[] = [
  field('id', 'string | number', '薪资账套项目ID'),
  field('ledgerId', 'string | number | null', '所属账套ID', { nullable: true }),
  field('itemId', 'string | number | null', '基础薪资项目ID', { nullable: true }),
  field('name', 'string | null', '薪资项目名称；编辑页不允许改名', { nullable: true }),
  field('attribute', 'number | null', '属性：1固定项、2计算项、3外部数据、4系统参数', { nullable: true }),
  field('fixedValue', 'string | number | null', '固定项的值；非固定项由Portal联动清为空值', { nullable: true }),
  field('formula', 'string | null', '计算项公式；属性为2时编辑前先调用公式校验', { nullable: true }),
  field('parameter', 'string | number | null', '系统参数ID；属性为4时必填', { nullable: true }),
  field('parameterName', 'string | null', '系统参数显示名称；只读', { nullable: true }),
  field('type', 'number | null', '类型：1税前加、2税后加、3税前减、4税后减、5计算过渡、6结果', { nullable: true }),
  field('scale', 'number | null', '小数位数，0至4整数', { nullable: true }),
  field('carryRule', 'number | null', '进位规则：1四舍五入、2向上取整、3向下取整', { nullable: true }),
  field('sort', 'number | null', '页面排序；缺省按0', { nullable: true }),
  field('remark', 'string | null', '备注，最多200字符', { nullable: true }),
]

const listOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: packageFields.map(item => ({ ...item, path: `[].${item.path}` })),
  empty: '[]表示当前用户按角色/租户/权限可见范围内没有薪资账套；权限、会话、网络或响应形状错误会抛出，不降级为空成功。',
}

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('list', 'object[]', 'Portal薪资项目管理页分页列表'),
    ...itemFields.map(item => ({ ...item, path: `list[].${item.path}` })),
    field('total', 'number', '后端PageData.total；用于Portal分页器'),
  ],
  empty: 'list=[]且total=0表示当前账套没有项目；权限、会话、网络或响应形状错误会抛出。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: packageFields,
  empty: '不存在、无权限或响应字段不符合Portal编辑表单时抛出；不返回空对象冒充详情。',
}

const itemDetailOutput: AiContract['output'] = {
  shape: 'object',
  fields: itemFields,
  empty: '不存在、无权限或响应字段不符合Portal薪资项目编辑表单时抛出。',
}

const preparationOutput = (label: string): AiContract['output'] => ({
  shape: '{ draft: object, previous?: object }',
  fields: [
    field('draft', 'object', `${label}按Portal表单规则校验后的完整草稿，尚未发写请求`),
    field('previous', 'object', '编辑前的完整表单快照；取消时只丢弃draft，不调用写接口', { optional: true }),
  ],
  empty: '输入字段、ID、枚举、长度或关联权限不符合Portal时在发请求前抛错。',
})

const removePreparationOutput: AiContract['output'] = {
  shape: '{ ids: (string | number)[] }',
  fields: [field('ids', '(string | number)[]', '经去重和校验、等待用户确认的删除ID数组')],
  empty: 'ids为空、重复或不是有效ID时在发请求前抛错；取消时不调用DELETE。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求成功后的SDK成功值；不包含后端更新后的对象')],
  empty: '请求抛错不能报告成功；true也不能代替写入后的列表/详情回查。',
}

const arrayOutput = (label: string, fields: AiField[] = [field('[]', 'object', label)]): AiContract['output'] => ({
  shape: 'object[]',
  fields,
  empty: '[]表示当前权限范围内没有候选；权限、会话、网络或响应形状错误会抛出。',
})

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ test/portal/main: app/portal/menus/hr.js、views/dashboard/hr/manage/salary-package/list.vue、[mode]/[id].vue、components/copy.vue、item/[id]/item-list.vue、item/[id]/components/include.vue、manage/common/salary/[mode]/[id].vue、components/portal/hxr/select/org/index.vue、components/portal/hxr/tree-select/role-org/index.vue、common/libs/renren/list.js、common/libs/renren/form.js', kind: 'reference', note: '逐页核对菜单权限、platform实例、module-type=14、无参数账套列表、账套表单整表POST、复制/跨页批量删除、项目分页/引入/编辑、组织/角色候选、公式候选和公式校验请求。' },
  { source: 'CodeReview_Mall_Platform_Java @ test/test: SalaryLedgerController、SalaryLedgerItemController、SalaryLedgerDTO、SalaryLedgerItemDTO、CopyLedgerDTO、ImportSalaryItemDTO、SalaryLedgerServiceImpl、SalaryLedgerItemServiceImpl、SalaryLedgerItemDao.xml', kind: 'reference', note: '核对账套和项目端点、Java Long/枚举字段、角色授权范围、重复名称、软删除、初始化必需项目、导入重复检查和公式按账套校验。' },
  { source: 'src/capabilities/salary-package.ts 与 test/salary-package.test.ts', kind: 'implementation', note: '锁定逐字段请求、Portal表单联动、prepare→submit→cancel动作契约、坏输入和坏响应反证；不替代真实环境写入回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作Portal「人力系统 → 薪酬管理 → 薪资账套」列表、账套表单、薪资项目管理子页或项目编辑表单。',
  boundaries: [
    '页面路径是/dashboard/manage/salary-package/list，权限是/dashboard/manage/salary-package；所有请求使用platform HTTP实例和module-type=14（薪酬管理）。',
    '账套列表是GET /salary/ledger/selectListByRole且Portal不传查询参数；返回数组，不自行追加分页参数。结果受当前会话、租户、账套授权角色、页面权限和后端数据范围约束。',
    '账套表单name、organizationId、type、countRange、roleIdList必填，name最多50字符；organizationName是显示字段但Portal customSubmit会随完整表单一起POST。新建和编辑都POST /salary/ledger，编辑通过payload里的id区分，不能改成PUT。',
    '账套复制POST /salary/ledger/copyLedger；主账套和项目删除都是DELETE并把ID数组放在请求体；Portal支持跨页选择，SDK不得只删当前页。',
    '薪资项目分页请求固定带ledgerId、order=""、orderField=""、pageNo、pageSize；项目编辑表单的属性联动会清空formula/parameter/fixedValue，计算项保存前先GET /salary/item/checkFormula，随后PUT /salary/ledgerItem。',
    '角色选择器实际只调用/sys/role/hrRoleListNew，不发送project=3参数；组织选择器先读getTree，打开后按pageByOrgId分页。候选ID必须来自对应候选结果或用户明确提供的已核实ID。',
    'SDK成功回执不能代替业务证据；写入或超时后按steps回查列表、详情或项目列表，不盲目重放可能产生重复/不可恢复的操作。',
  ],
  prerequisites: ['用当前用户会话、租户、页面权限和module-type上下文创建SDK；不要从浏览器提取凭据。', '写操作先执行对应prepare并保留用户确认的draft，用户取消只丢弃draft，不发写请求。'],
  failures: ['字段校验、枚举/ID、名称重复、角色/组织权限、项目重复导入、公式错误、网络或响应形状错误会抛出；不把空数组或HTTP成功包装成错误的业务结果。'],
  evidence,
  gaps: ['已完成Portal/Java逐页静态核对与离线请求断言；尚未在真实测试环境执行本页账套及薪资项目的prepare→submit→cancel、删除/导入后的业务数据回查。'],
})

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Salary package contract has no definition: ${id}`)
  contracts[id] = value
}

const idInput = (meaning: string, source: string): Record<string, AiParameter> => ({ id: param(meaning, source, { type: 'string | number', required: true }) })
const draftInput = (meaning: string, source: string): AiParameter => param(meaning, source, { type: 'object', required: true })

add('salary-package-list', base({ purpose: '读取当前用户在薪资账套列表页可见的账套。', effect: 'read', inputs: {}, output: listOutput, consume: ['用[].id作为get、prepareUpdate、prepareCopy、prepareRemove和itemList的唯一定位；不要用名称代替ID。'], steps: [], completion: '返回Portal列表数组；查询不修改数据。', idempotency: null }))
add('salary-package-get', base({ purpose: '读取一条薪资账套的最新编辑表单数据。', effect: 'read', inputs: idInput('薪资账套ID。', 'salary-package-list[].id'), output: detailOutput, consume: ['把id、name、organizationId、organizationName、type、countRange、roleIdList完整交给prepareUpdate；不猜权限角色。'], steps: [], completion: '得到与Portal customLoad一致的账套详情快照。', idempotency: null }))
add('salary-package-prepare-create', base({ purpose: '按Portal账套新建表单规则准备未写入草稿。', effect: 'prepare', inputs: { form: param('账套表单：name、organizationId、organizationName、type、countRange、roleIdList。', '用户明确填写和候选选择', { type: 'object', required: true, constraints: ['name必填且最多50字符；不自动trim', 'organizationId、type、countRange、roleIdList必填；roleIdList至少一个ID'] }) }, output: preparationOutput('薪资账套'), consume: ['确认后只把draft传给salary-package-create；取消不调用写接口。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'salary-package-create', mapping: { draft: 'result.draft' }, instruction: '提交同一draft；成功或超时后按name和完整字段回查列表/详情。' }, { role: 'cancel', when: '用户取消账套表单', instruction: '丢弃draft，不调用create。' }], completion: '得到已校验、尚未写入的账套草稿。', idempotency: null }))
add('salary-package-create', base({ purpose: '保存薪资账套新建草稿。', effect: 'write', inputs: { draft: draftInput('salary-package-prepare-create返回的完整草稿。', 'salary-package-prepare-create.draft') }, output: trueOutput, consume: ['严格按Portal发送POST /salary/ledger；不把无id新建改成其他端点。'], steps: [{ role: 'required', when: '请求成功或超时', capabilityId: 'salary-package-list', mapping: {}, instruction: '按精确name寻找新增账套，逐字段核对组织、类型、计税区间和授权角色；不凭true回执报告完成。' }, { role: 'cancel', when: '用户在prepare阶段取消', instruction: '不调用create。' }], completion: '列表/详情回查确认新账套和权限字段一致后才报告完成。', idempotency: '后端无requestId；超时先按唯一名称回查，不能盲目重试创建。' }))
add('salary-package-prepare-update', base({ purpose: '基于最新详情和用户明确修改准备账套编辑草稿。', effect: 'prepare', inputs: { current: param('salary-package-get返回的最新账套详情。', 'salary-package-get', { type: 'object', required: true }), changes: param('用户明确修改的表单字段；省略字段保持current。', '用户编辑意图', { type: 'object', required: false, nullable: true }) }, output: preparationOutput('薪资账套'), consume: ['取消只丢弃draft；确认把完整draft交给salary-package-update。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'salary-package-update', mapping: { draft: 'result.draft' }, instruction: '完整提交draft；完成后按同一ID逐字段回查。' }, { role: 'cancel', when: '用户取消编辑', instruction: '不调用update。' }], completion: '得到含原ID、已校验且尚未写入的完整草稿。', idempotency: null }))
add('salary-package-update', base({ purpose: '保存薪资账套编辑草稿。', effect: 'write', inputs: { draft: draftInput('salary-package-prepare-update返回的完整草稿，必须包含id。', 'salary-package-prepare-update.draft'), 'draft.id': param('编辑账套ID；从完整草稿中取出作为回查定位。', 'salary-package-prepare-update.draft.id', { type: 'string | number', required: true }) }, output: trueOutput, consume: ['严格按Portal发送POST /salary/ledger并包含id；后端服务通过id执行更新，不能发送PUT。'], steps: [{ role: 'required', when: '请求成功或超时', capabilityId: 'salary-package-get', mapping: { id: 'args.draft.id' }, instruction: '读取同一ID，逐字段核对name、组织、类型、计税区间和roleIdList。' }, { role: 'cancel', when: '用户在prepare阶段取消', instruction: '不调用update。' }], completion: '详情回查确认完整表单一致后报告保存完成。', idempotency: 'POST保存无requestId；超时先get确认，不能盲目重发。' }))
add('salary-package-prepare-copy', base({ purpose: '按复制弹窗规则准备账套复制草稿。', effect: 'prepare', inputs: { form: param('复制表单：源账套ledgerId和新账套name。', '用户从列表选定源账套并填写复制名称', { type: 'object', required: true, constraints: ['ledgerId必须是列表中的有效ID', 'name必填且最多50字符'] }) }, output: preparationOutput('薪资账套复制'), consume: ['确认后把draft交给salary-package-copy；取消不调用复制。'], steps: [{ role: 'required', when: '用户确认复制', capabilityId: 'salary-package-copy', mapping: { draft: 'result.draft' }, instruction: '提交同一源ID和名称，完成后按新名称回查账套及项目。' }, { role: 'cancel', when: '用户取消复制弹窗', instruction: '不调用copy。' }], completion: '得到未发请求的复制草稿。', idempotency: null }))
add('salary-package-copy', base({ purpose: '复制一套薪资账套及其项目。', effect: 'write', inputs: { draft: draftInput('salary-package-prepare-copy返回的源账套ID和新名称。', 'salary-package-prepare-copy.draft') }, output: trueOutput, consume: ['严格发送POST /salary/ledger/copyLedger；后端复制源账套授权和项目，响应不提供新ID。'], steps: [{ role: 'required', when: '请求成功或超时', capabilityId: 'salary-package-list', mapping: {}, instruction: '按新名称回查新账套并取得新ID，再调用itemList逐项核对复制结果。' }, { role: 'cancel', when: '用户取消复制', instruction: '不调用copy。' }], completion: '列表和项目回查确认新账套存在且项目已复制后报告完成。', idempotency: '无requestId；超时按新名称回查，不能盲目再次复制。' }))
add('salary-package-prepare-remove', base({ purpose: '准备跨页批量删除薪资账套ID。', effect: 'prepare', inputs: { ids: param('用户在列表中选中的账套ID数组。', 'salary-package-list[].id和Portal跨页选择状态', { type: 'array', required: true }) }, output: removePreparationOutput, consume: ['先展示用户确认的完整ID集合；取消不发DELETE。'], steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'salary-package-remove', mapping: { ids: 'result.ids' }, instruction: '只提交同一批ID；删除后逐页回查列表。' }, { role: 'cancel', when: '用户取消删除确认', instruction: '丢弃ids，不调用remove。' }], completion: '得到无副作用的删除ID草稿。', idempotency: null }))
add('salary-package-remove', base({ purpose: '按Portal批量删除请求软删除薪资账套。', effect: 'write', inputs: { ids: param('待删除的账套ID数组。', 'salary-package-prepare-remove或salary-package-list[].id', { type: 'array', required: true }) }, output: trueOutput, consume: ['严格发送DELETE /salary/ledger，数组放请求体；删除后人员可能无法使用相关账套。'], steps: [{ role: 'required', when: '请求成功或超时', capabilityId: 'salary-package-list', mapping: {}, instruction: '按删除前可见范围回查，确认目标ID不再出现；权限/后端拒绝保留原错误。' }], completion: '回查确认目标账套从当前列表消失后报告完成。', idempotency: '删除无requestId且业务上不可恢复；超时先回查，不自动重放。' }))
add('salary-package-organization-tree', base({ purpose: '读取账套所属组织选择器的组织树。', effect: 'read', inputs: {}, output: arrayOutput('组织树节点', [field('[]', 'object', 'Portal组织树节点；保留children和后端原字段')]), consume: ['只把节点id作为organizationId候选，把name作为organizationName显示值。'], steps: [], completion: '返回当前用户可见组织树。', idempotency: null }))
add('salary-package-organization-page', base({ purpose: '按Portal组织选择器查询可选组织分页。', effect: 'read', inputs: { name: param('组织名称筛选；缺省发送空字符串。', '组织选择器输入', { type: 'string', default: '空字符串' }), type: param('组织类型筛选；缺省发送空字符串。', '组织选择器下拉', { type: 'string | number', default: '空字符串' }), orgId: param('树上选中的父组织ID；未选择发送空字符串。', '组织树选择', { type: 'string | number', required: false, nullable: true, default: '空字符串' }), pageNo: param('组织候选页码，默认1。', '组织选择器分页', { type: 'number', default: '1' }), pageSize: param('组织候选每页数量，默认10。', '组织选择器分页', { type: 'number', default: '10' }) }, output: { shape: '{ list: object[], total: number }', fields: [field('list', 'object[]', '组织候选页'), field('total', 'number', '候选总数')], empty: 'list=[]表示当前筛选下没有组织候选。' }, consume: ['用候选id/name填入账套表单organizationId/organizationName。'], steps: [], completion: '返回组织选择器当前页。', idempotency: null }))
add('salary-package-role-options', base({ purpose: '读取账套权限选择器的角色树。', effect: 'read', inputs: {}, output: arrayOutput('角色树节点', [field('[]', 'object', 'Portal角色树节点；保留children和后端原字段')]), consume: ['用节点id填入roleIdList；Portal传入的project=3不是请求参数，不能自行追加。'], steps: [], completion: '返回当前用户可见角色候选。', idempotency: null }))
add('salary-package-item-list', base({ purpose: '读取指定账套下的薪资项目分页。', effect: 'read', inputs: { ledgerId: param('账套ID。', 'salary-package-list[].id', { type: 'string | number', required: true }), pageNo: param('项目页码，默认1。', 'Portal分页状态', { type: 'number', default: '1' }), pageSize: param('项目每页数量，默认20。', 'Portal分页状态', { type: 'number', default: '20' }) }, output: pageOutput, consume: ['用list[].id进入项目编辑或删除；保留ledgerId作为引入和公式校验上下文。'], steps: [], completion: '返回当前账套项目分页。', idempotency: null }))
add('salary-package-item-get', base({ purpose: '读取薪资账套项目编辑表单。', effect: 'read', inputs: idInput('账套项目ID。', 'salary-package-item-list.list[].id'), output: itemDetailOutput, consume: ['完整保留详情作为prepareItemUpdate.current；不能用列表列值拼公式、参数或固定值。'], steps: [], completion: '获得Portal common/salary编辑页使用的项目详情。', idempotency: null }))
add('salary-package-item-formula-options', base({ purpose: '读取项目公式编辑器显示的全部薪资项目候选。', effect: 'read', inputs: {}, output: arrayOutput('公式候选', [field('[]', 'object', '候选项目；至少包含id和name')]), consume: ['公式编辑器只用候选name展示变量，不把数组下标当ID。'], steps: [], completion: '返回公式变量候选。', idempotency: null }))
add('salary-package-item-check-formula', base({ purpose: '按Portal项目编辑表单校验计算公式。', effect: 'read', inputs: { formula: param('待校验公式原文。', 'attribute=2的项目编辑表单', { type: 'string', required: true }) }, output: { shape: 'void', fields: [], empty: '请求抛错表示公式校验失败；成功无业务数据。' }, consume: ['只有校验成功后才继续itemUpdate；不把本地字符串检查代替后端公式校验。'], steps: [], completion: '后端公式校验请求成功。', idempotency: null }))
add('salary-package-item-prepare-update', base({ purpose: '基于项目详情和用户修改准备项目编辑草稿。', effect: 'prepare', inputs: { current: param('salary-package-item-get返回的完整详情。', 'salary-package-item-get', { type: 'object', required: true }), changes: param('用户明确修改的项目字段；省略字段保持current。', '用户编辑意图', { type: 'object', required: false, nullable: true }) }, output: preparationOutput('薪资账套项目'), consume: ['属性变化按Portal联动清空不适用字段；取消不发请求。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'salary-package-item-update', mapping: { draft: 'result.draft' }, instruction: '提交完整draft；计算项先公式校验，完成后itemGet逐字段回查。' }, { role: 'cancel', when: '用户取消项目编辑', instruction: '不调用itemUpdate。' }], completion: '得到含原ID/账套ID、已按联动规则校验且尚未写入的项目草稿。', idempotency: null }))
add('salary-package-item-update', base({ purpose: '保存薪资账套项目编辑草稿。', effect: 'write', inputs: { draft: draftInput('salary-package-item-prepare-update返回的完整草稿。', 'salary-package-item-prepare-update.draft'), 'draft.id': param('项目编辑ID；从完整草稿中取出作为回查定位。', 'salary-package-item-prepare-update.draft.id', { type: 'string | number', required: true }) }, output: trueOutput, consume: ['属性为2时SDK先GET /salary/item/checkFormula，再PUT /salary/ledgerItem；属性不是2时formula为空字符串。'], steps: [{ role: 'required', when: '请求成功或超时', capabilityId: 'salary-package-item-get', mapping: { id: 'args.draft.id' }, instruction: '逐字段回查name、attribute、fixedValue、formula、parameter、type、scale、carryRule、sort和remark。' }, { role: 'cancel', when: '用户在prepare阶段取消', instruction: '不调用itemUpdate。' }], completion: '公式校验（如需）和PUT成功，且详情回查一致后报告完成。', idempotency: 'PUT为覆盖写；超时先itemGet确认，不盲目重发。' }))
add('salary-package-item-available', base({ purpose: '读取指定账套尚未引入的薪资项目候选。', effect: 'read', inputs: { ledgerId: param('账套ID。', 'salary-package-item-list的账套上下文', { type: 'string | number', required: true }) }, output: arrayOutput('可引入薪资项目', [field('[]', 'object', '基础薪资项目候选；至少包含id和name')]), consume: ['只把候选id传给prepareItemImport；不要凭名称猜ID。'], steps: [], completion: '返回引入弹窗当前可选项目。', idempotency: null }))
add('salary-package-item-prepare-import', base({ purpose: '准备批量引入薪资项目草稿。', effect: 'prepare', inputs: { ledgerId: param('目标账套ID。', 'salary-package-item-list上下文', { type: 'string | number', required: true }), salaryItemId: param('引入弹窗勾选的基础薪资项目ID数组。', 'salary-package-item-available[].id', { type: 'array', required: true }) }, output: preparationOutput('引入薪资项目'), consume: ['确认后把draft传给itemImport；取消只丢弃draft。'], steps: [{ role: 'required', when: '用户确认引入', capabilityId: 'salary-package-item-import', mapping: { draft: 'result.draft' }, instruction: '只提交同一账套和勾选ID；完成后itemList回查。' }, { role: 'cancel', when: '用户取消引入弹窗', instruction: '不调用itemImport。' }], completion: '得到非空、去重且尚未发请求的引入草稿。', idempotency: null }))
add('salary-package-item-import', base({ purpose: '把勾选的基础薪资项目导入账套。', effect: 'write', inputs: { draft: draftInput('salary-package-item-prepare-import返回的ledgerId和salaryItemId数组。', 'salary-package-item-prepare-import.draft'), 'draft.ledgerId': param('目标账套ID；从完整引入草稿中取出作为回查上下文。', 'salary-package-item-prepare-import.draft.ledgerId', { type: 'string | number', required: true }) }, output: trueOutput, consume: ['严格POST /salary/ledgerItem/importSalaryItem，字段名是salaryItemId数组；后端拒绝重复导入并按计算项公式检查。'], steps: [{ role: 'required', when: '请求成功或超时', capabilityId: 'salary-package-item-list', mapping: { ledgerId: 'args.draft.ledgerId' }, instruction: '回查项目列表，确认每个目标基础项目已出现；重复导入错误保留。' }, { role: 'cancel', when: '用户在prepare阶段取消', instruction: '不调用itemImport。' }], completion: '项目列表回查确认目标项目已导入后报告完成。', idempotency: '后端没有requestId且重复导入会失败；超时先回查，不能盲目重试。' }))
add('salary-package-item-prepare-remove', base({ purpose: '准备跨页批量删除账套项目ID。', effect: 'prepare', inputs: { ids: param('项目列表中用户选中的项目ID数组。', 'salary-package-item-list.list[].id和Portal跨页选择状态', { type: 'array', required: true }) }, output: removePreparationOutput, consume: ['展示确认的完整ID集合；取消不发DELETE。'], steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'salary-package-item-remove', mapping: { ids: 'result.ids' }, instruction: '提交同一批项目ID，完成后itemList回查。' }, { role: 'cancel', when: '用户取消删除', instruction: '不调用itemRemove。' }], completion: '得到无副作用项目删除草稿。', idempotency: null }))
add('salary-package-item-remove', base({ purpose: '按Portal批量删除指定账套项目。', effect: 'write', inputs: { ids: param('待删除项目ID数组。', 'salary-package-item-prepare-remove或salary-package-item-list.list[].id', { type: 'array', required: true }) }, output: trueOutput, consume: ['严格DELETE /salary/ledgerItem并把ID数组放请求体；后端执行软删除。'], steps: [{ role: 'required', when: '请求成功或超时', capabilityId: 'salary-package-item-list', mapping: {}, instruction: '用原账套ID逐页回查，确认目标项目不再出现。' }], completion: '项目列表回查确认目标ID消失后报告完成。', idempotency: '删除无requestId且不可恢复；超时先回查，不自动重放。' }))

export const SALARY_PACKAGE_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALARY_PACKAGE_METHODS).map(id => [id, contracts[id]!]))
export const SALARY_PACKAGE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALARY_PACKAGE_METHODS).map(([id, method]) => [`salaryPackage.${method}`, SALARY_PACKAGE_AI_CONTRACTS[id]!]))
