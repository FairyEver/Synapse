import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_METHODS } from '../capabilities/finance-setting-sale-allocation-coefficient.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })
const statusOptions = [{ value: 0, label: '停用' }, { value: 1, label: '启用' }]

const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用名称、行号或租户ID代替']
const id = input('销售分配系数主记录ID；不是产品组ID或分类ID', 'finance-setting-sale-allocation-coefficient-list.list[].id 或详情返回的id', { type: 'string | number', constraints: idRules })
const targetStatus = input('绝对目标状态：0停用、1启用；不是无条件切换', '用户明确的启用/停用意图，并与当前列表行status相反', { type: 'integer', options: statusOptions, constraints: ['只能是0或1；必须与current.status相反'] })

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '销售分配系数主记录ID；详情和启停使用该ID', { constraints: idRules }),
  field('list[].tenantName', 'string', '租户名称；列表原文显示', { nullable: true, nullMeaning: '后端未返回租户名称，不能据此推断租户ID' }),
  field('list[].categoryName', 'string', '分类名称；可能是逗号分隔的多个分类名称', { nullable: true, nullMeaning: '后端未返回分类名称' }),
  field('list[].coefficient', 'number | string', '统计指标系数；页面原值显示，单位是系数而不是百分比', { nullable: true, nullMeaning: '后端未返回系数；不能按0补值' }),
  field('list[].status', 'integer', '绝对状态：0停用、1启用', { values: { '0': '停用', '1': '启用' } }),
  field('list[].updateTime', 'string | number', '更新时间原值；页面原文显示，不由SDK换算时区', { nullable: true, nullMeaning: '后端未返回更新时间' }),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: array, total: integer }',
  fields: [
    field('$', 'object', '销售分配系数分页结果'),
    field('list', 'array', '当前页列表，不是全部匹配记录'),
    field('list[]', 'object', '一条页面列表行'),
    ...rowFields,
    field('total', 'integer', '筛选后的总记录数，不是当前页长度', { constraints: ['非负整数'] }),
  ],
  empty: 'list=[]且total=0表示当前筛选没有记录；权限、网络或响应形状失败会抛错，不改写为空列表。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object | null',
  fields: [
    field('$', 'object | null', '销售分配系数详情；后端未找到ID时为null', { nullable: true, nullMeaning: '该ID不存在或已不可见' }),
    field('id', 'string | number', '销售分配系数主记录ID', { constraints: idRules }),
    field('tenantName', 'string', '租户名称原值', { nullable: true, nullMeaning: '详情未返回租户名称' }),
    field('categoryName', 'string', '分类名称原值', { nullable: true, nullMeaning: '详情未返回分类名称' }),
    field('coefficient', 'number | string', '统计指标系数原值', { nullable: true, nullMeaning: '详情未返回系数' }),
  ],
  empty: 'null不能当作可提交的空白草稿；先刷新列表并确认ID。',
}

const createInputs: Record<string, AiParameter> = {
  productGroupId: input('产品组ID；页面表单校验要求必填，不能传产品组名称', '用户在产品组选择器的表单值；当前源码控件被注释但校验仍保留', { type: 'string | number', constraints: idRules }),
  categoryId: input('分类ID数组；页面分类树为多选', '用户在分类树选择的ID数组', { type: 'array<string | number>', constraints: ['非空数组', '每个ID为安全正整数', '不能重复'] }),
  coefficient: input('统计指标系数', '用户在a-input-number中输入', { type: 'number', constraints: ['0至10000', '最多两位小数', '不是百分比字符串'] }),
}

const queryInputs: Record<string, AiParameter> = {
  tenantName: optional('租户名称筛选文本', '用户在列表租户名称输入框输入', 'SDK不发送该键；不限制租户名称', { type: 'string', nullable: true }),
  productGroupId: optional('产品组ID筛选', '用户在产品组字典选择器选择', 'SDK不发送该键；不限制产品组', { type: 'string | number', nullable: true, constraints: idRules }),
  categoryId: optional('分类ID筛选', '用户在分类树选择器选择', 'SDK不发送该键；不限制分类', { type: 'string | number', nullable: true, constraints: idRules }),
  status: optional('绝对状态筛选：0停用、1启用', '页面状态单选项', 'SDK默认1，即页面初始值为启用', { type: 'integer', options: statusOptions }),
  pageNo: optional('从1开始的页码', '调用方分页状态', 'SDK默认1', { type: 'integer', constraints: ['正整数'] }),
  pageSize: optional('当前页条数', '调用方分页状态', 'SDK默认20', { type: 'integer', constraints: ['只能取10、20、50、100'] }),
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/menus/finance.js 与 app/portal/views/dashboard/finance/setting/sale-allocation-coefficient.vue', kind: 'reference', note: '证明菜单路径、页面权限及列表/表单/详情路由；固定检出未pull，不能替代最新部署证据。' },
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/sale-allocation-coefficient/list.vue、[mode]/[id].vue、detail/[id].vue、common/libs/renren/list.js', kind: 'reference', note: '证明platform实例、列表内部默认表单、分页、可见按钮权限、GET/POST/PUT路径、表单校验和详情消费字段。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 SalesAllocationCoefficientController、PageReqVO、SaveReqVO、RespVO', kind: 'reference', note: '证明分页、详情、创建、状态更新端点、载荷字段和返回类型；固定检出未pull。' },
  { source: 'src/capabilities/finance-setting-sale-allocation-coefficient.ts', kind: 'implementation', note: '证明SDK字段校验、请求载荷、页面上下文和返回投影；不替代真实环境验证。' },
  { source: 'test/finance-setting-sale-allocation-coefficient.test.ts', kind: 'test', note: '离线夹具锁定默认参数、表单载荷、权限/路径、状态补偿、坏响应和关键字段反证；测试不发真实网络。' },
]

const boundaries = [
  '覆盖页面分页、详情、创建和行内启停；页面列表没有编辑/删除按钮，因此不发布后端update、export-excel、get-by-product-category、used-category-ids等非页面动作。',
  '页面源码的列表form内部仍保留unit、allocateOrg、ruleType、expenseType、indicator等旧字段；SDK默认复现这些实际发送的键，但不把它们作为AI可操作业务筛选。',
  '创建表单实际发送productGroupId、categoryId、coefficient；页面控件与校验存在不一致，SDK按提交前校验和Java SaveReqVO交集要求productGroupId必填并记录该风险。',
  '启停请求只发送{id,status}，status是绝对值；previous草稿可通过同一PUT恢复操作前状态，不是事务回滚。',
  '使用platform实例，页面目录moduleType=null；SDK不发送module-type。',
]

const failures = [
  'ID、分类数组、系数、状态或分页非法时在发请求前失败；不要把名称、行号或百分比替代ID/系数。',
  '列表/详情缺少页面消费字段或状态更新返回非true时抛错；不能把HTTP成功或空对象当业务成功。',
  '401/403、网络错误或后端业务错误原样抛出；权限不足不是空列表。',
  '写请求超时后先按ID重新读取确认创建/状态终态；未确认前不要盲目重发，创建没有页面提供的取消接口。',
]

function contract (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract {
  return {
    whenToUse: '操作Portal“财务设置→销售分配系数”页面的分页、详情、创建和启停动作。',
    boundaries,
    prerequisites: ['已建立带有效会话token与tenantId的platform SDK；页面和对应按钮权限由Portal/后端裁决。', 'ID来自当前列表或详情；写入前保留prepare返回的draft/previous。'],
    failures,
    evidence,
    gaps: ['未启动浏览器、未取得真实网络基准、未执行测试环境读请求或prepare→submit→cancel写闭环；本契约基于固定Portal/Java源码和离线测试。', '固定Portal/Java检出未按本任务约束pull到远端最新，真实权限、响应空值变体和部署版本差异未验证。'],
    ...value,
  }
}

const preparedCreateOutput: AiContract['output'] = {
  shape: '{ draft: { productGroupId, categoryId, coefficient } }',
  fields: [field('$', 'object', '无副作用的创建草稿'), field('draft', 'object', '提交给create的载荷'), field('draft.productGroupId', 'string | number', '产品组ID', { constraints: idRules }), field('draft.categoryId', 'array<string | number>', '非空分类ID数组'), field('draft.coefficient', 'number', '0至10000且最多两位小数的系数')],
  empty: '非法表单字段在准备阶段抛错，不返回草稿。',
}

const statusOutput: AiContract['output'] = {
  shape: '{ draft: { id, status }, previous: { id, status } }',
  fields: [field('$', 'object', '启停草稿和恢复快照'), field('draft', 'object', '目标写载荷'), field('draft.id', 'string | number', '记录ID'), field('draft.status', 'integer', '目标状态', { values: { '0': '停用', '1': '启用' } }), field('previous', 'object', '操作前快照'), field('previous.status', 'integer', '操作前状态', { values: { '0': '停用', '1': '启用' } })],
  empty: '目标状态与当前相同或字段非法时抛错。',
}

export const FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-sale-allocation-coefficient-list': contract({
    purpose: '按页面筛选和分页读取销售分配系数列表。', effect: 'read', inputs: queryInputs, output: pageOutput,
    consume: ['展示list页面字段；按total分页。保留每行id/status用于详情和启停。', '列表默认请求中包含Portal源码遗留的内部form键，但不要把它们当作可用业务筛选。'],
    steps: [{ role: 'optional', when: '用户要查看某行详情', capabilityId: 'finance-setting-sale-allocation-coefficient-get', mapping: { id: 'result.list[].id' }, instruction: '用当前行id读取详情，不能用分类ID替代。' }],
    completion: '返回当前筛选条件下的页面列表和total；不改变数据。', idempotency: null,
  }),
  'finance-setting-sale-allocation-coefficient-get': contract({
    purpose: '读取详情页实际展示的租户、分类名称和统计指标系数。', effect: 'read', inputs: { id }, output: detailOutput,
    consume: ['null表示ID未找到；非null仅消费详情字段，不推断后端未返回的产品组或状态。'], steps: [], completion: '获得详情对象或明确的null。', idempotency: null,
  }),
  'finance-setting-sale-allocation-coefficient-prepare-create': contract({
    purpose: '按页面新建表单校验生成无副作用创建草稿。', effect: 'prepare', inputs: createInputs, output: preparedCreateOutput,
    consume: ['确认productGroupId、分类数组和系数后，将draft原样交给create。'], steps: [{ role: 'required', when: '用户确认创建', capabilityId: 'finance-setting-sale-allocation-coefficient-create', mapping: { productGroupId: 'result.draft.productGroupId', categoryId: 'result.draft.categoryId', coefficient: 'result.draft.coefficient' }, instruction: '只提交prepare返回的draft；页面没有取消接口，失败或超时按ID回查。' }], completion: '产生可提交且未发网络请求的草稿。', idempotency: null,
  }),
  'finance-setting-sale-allocation-coefficient-create': contract({
    purpose: '创建一条销售分配系数记录。', effect: 'write', inputs: createInputs, output: { shape: 'string | number', fields: [field('$', 'string | number', '新创建记录ID；不是产品组ID或分类ID', { constraints: idRules })], empty: '缺少合法ID时抛错。' },
    consume: ['保存返回ID；随后list按可用筛选或详情回查，确认记录字段和默认status=1。'], steps: [{ role: 'required', when: '创建请求返回ID后确认落库', capabilityId: 'finance-setting-sale-allocation-coefficient-list', mapping: {}, instruction: '分页回查并核对同一ID；不要以HTTP成功代替落库证据。' }, { role: 'cancel', when: '创建失败或需清理', instruction: '页面和当前能力没有可逆取消/删除动作；停止并报告需受控运维清理，不能伪造cancel能力。' }], completion: '后端返回合法新记录ID且回查确认字段与预期一致。', idempotency: '后端没有requestId或SDK幂等包装；请求超时先按返回ID或创建字段回查，未确认前不要重复创建；页面没有可达取消/删除动作。',
  }),
  'finance-setting-sale-allocation-coefficient-prepare-set-status': contract({
    purpose: '根据当前列表行和绝对目标状态生成启停草稿及恢复快照。', effect: 'prepare', inputs: { current: input('最新列表行；至少包含id/status', 'finance-setting-sale-allocation-coefficient-list.list[]', { type: 'object' }), targetStatus }, output: statusOutput,
    consume: ['确认draft.status是用户明确目标且与previous.status相反后交给setStatus；previous只用于恢复。'], steps: [{ role: 'required', when: '用户确认状态变更', capabilityId: 'finance-setting-sale-allocation-coefficient-set-status', mapping: { draft: 'result.draft' }, instruction: '提交draft，不要把targetStatus当toggle。' }], completion: '产生无副作用的目标状态载荷和恢复快照。', idempotency: null,
  }),
  'finance-setting-sale-allocation-coefficient-set-status': contract({
    purpose: '把销售分配系数记录设置为绝对启用/停用状态。', effect: 'write', inputs: { draft: input('prepareSetStatus返回的{ id, status }', 'finance-setting-sale-allocation-coefficient-prepare-set-status.result.draft', { type: 'object' }) }, output: { shape: 'boolean', fields: [field('$', 'boolean', '后端更新成功标志；只接受true', { values: { true: '更新成功' } })], empty: 'false或其它回执抛错。' },
    consume: ['成功后按同一ID回查最新status；如需恢复且目标已确认，使用prepare.previous作为新的draft。'], steps: [{ role: 'required', when: '写入返回true或超时后确认终态', capabilityId: 'finance-setting-sale-allocation-coefficient-list', mapping: {}, instruction: '回查同一记录ID，不要按列表第一行认领结果。' }, { role: 'cancel', when: '用户明确要求恢复且previous仍来自同一条记录', capabilityId: 'finance-setting-sale-allocation-coefficient-set-status', mapping: { draft: 'context.previous' }, instruction: '把previous作为恢复draft再次提交；这不是事务回滚。' }], completion: '后端返回true且回查确认同一ID达到目标status。', idempotency: '后端没有requestId或SDK幂等包装；这是绝对状态写入，同一目标重复提交通常收敛，但超时仍须先按同一ID回查，不能把toggle盲目重发。',
  }),
}

export const FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_METHODS).map(([id, method]) => [`financeSettingSaleAllocationCoefficient.${method}`, FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_AI_CONTRACTS[id]!]),
)
