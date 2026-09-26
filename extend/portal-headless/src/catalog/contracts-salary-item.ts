import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALARY_ITEM_METHODS } from '../capabilities/salary-item.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用名称、行号或选项标签代替ID']

const rowFields = (prefix: string): AiField[] => {
  const at = (key: string) => prefix ? `${prefix}.${key}` : key
  return [
    field(at('id'), 'string | number', '薪资项目主键；用于读取、修改和删除', { optional: true, nullable: true, nullMeaning: '后端未返回主键', constraints: idRules }),
    field(at('name'), 'string', '薪资项目名称', { nullable: true, nullMeaning: '后端未返回名称' }),
    field(at('isMust'), 'integer', '是否强制使用：0否、1是', { nullable: true, nullMeaning: '后端未返回标志', values: { '0': '否', '1': '是' } }),
    field(at('attribute'), 'integer', '属性：1固定项、2计算项、3外部数据、4系统参数', { nullable: true, nullMeaning: '后端未返回属性' }),
    field(at('type'), 'integer', '类型：1税前加、2税后加、3税前减、4税后减、5计算过渡、6结果', { nullable: true, nullMeaning: '后端未返回类型' }),
    field(at('scale'), 'integer', '小数点位数，页面限制0至4', { nullable: true, nullMeaning: '后端未返回小数位数' }),
    field(at('carryRule'), 'integer', '进位规则：1四舍五入、2向上取整、3向下取整', { nullable: true, nullMeaning: '后端未返回进位规则' }),
    field(at('remark'), 'string', '备注；页面最多200字符', { nullable: true, nullMeaning: '未填写备注或后端未返回' }),
    field(at('formula'), 'string', '计算项公式原文', { optional: true, nullable: true, nullMeaning: '非计算项或后端未返回公式' }),
    field(at('parameter'), 'string | number', '系统参数ID，属于系统参数命名空间', { optional: true, nullable: true, nullMeaning: '非系统参数或未配置', constraints: idRules }),
    field(at('parameterName'), 'string', '系统参数名称', { optional: true, nullable: true, nullMeaning: '后端未返回系统参数名称' }),
  ]
}

const listOutput: AiContract['output'] = {
  shape: '{ list: array, total: integer }',
  fields: [field('$', 'object', '薪资项目分页'), field('list', 'array', '当前页记录，不是全部记录'), field('list[]', 'object', '一条薪资项目记录'), ...rowFields('list[]'), field('total', 'integer', '筛选结果总数，不是当前页长度')],
  empty: 'list=[]且total=0表示当前筛选无记录；权限、网络或响应形状错误会抛出。',
}
const rowOutput: AiContract['output'] = { shape: 'object', fields: [field('$', 'object', '薪资项目详情'), ...rowFields('')], empty: '找不到记录时以后端错误或空响应失败，不拿空对象当作可编辑草稿。' }
const voidOutput: AiContract['output'] = { shape: 'undefined', fields: [field('$', 'undefined', '请求成功无业务返回值；失败抛错')], empty: 'Promise正常完成表示服务端接受请求，不等于独立回查已完成。' }
const prepareRemoveOutput: AiContract['output'] = { shape: '{ ids: array }', fields: [field('$', 'object', '删除前的本地确认草稿'), field('ids', 'array', '去重后的薪资项目ID'), field('ids[]', 'string | number', '一条待删除的薪资项目ID', { constraints: idRules })], empty: 'ids为空或重复会在SDK侧失败；取消时不调用remove。' }

const queryInputs: Record<string, AiParameter> = {
  attribute: optional('属性筛选：1固定项、2计算项、3外部数据、4系统参数', 'Portal属性下拉框', 'SDK发送空字符串，不限制属性', { type: 'integer', nullable: true }),
  type: optional('类型筛选：1税前加、2税后加、3税前减、4税后减、5计算过渡、6结果', 'Portal类型下拉框', 'SDK发送空字符串，不限制类型', { type: 'integer', nullable: true }),
  name: optional('薪资项目名称筛选文本', 'Portal名称输入框', 'SDK发送空字符串，不限制名称', { type: 'string', nullable: true }),
  pageNo: optional('页码，从1开始', 'Portal分页状态', 'SDK默认1', { type: 'integer' }),
  pageSize: optional('每页条数', 'Portal分页状态', 'SDK默认20', { type: 'integer', constraints: ['10、20、50、100、200、500'] }),
}
const draftInputs: Record<string, AiParameter> = {
  name: input('薪资项目名称', '用户输入；修改时先读取当前详情', { type: 'string', constraints: ['必填、不能全为空格、最多50字符'] }),
  isMust: optional('是否强制使用：0否、1是', 'Portal表单开关', 'SDK按Portal默认发送0', { type: 'integer', constraints: ['只能是0或1'] }),
  attribute: input('属性枚举', 'Portal属性下拉框', { type: 'integer', options: [{ value: 1, label: '固定项' }, { value: 2, label: '计算项' }, { value: 3, label: '外部数据' }, { value: 4, label: '系统参数' }] }),
  formula: optional('计算项公式原文', 'attribute=2时的公式编辑器', '非计算项由SDK按Portal联动清空为""；attribute=2时必填且先调用checkFormula', { type: 'string', nullable: true }),
  parameter: optional('系统参数ID', 'attribute=4时的参数选择器', '非系统参数由SDK按Portal联动清空为""；attribute=4时必填', { type: 'string | number', nullable: true, constraints: idRules }),
  type: input('薪资项目类型枚举', 'Portal类型下拉框', { type: 'integer', options: [{ value: 1, label: '税前加' }, { value: 2, label: '税后加' }, { value: 3, label: '税前减' }, { value: 4, label: '税后减' }, { value: 5, label: '计算过渡' }, { value: 6, label: '结果' }] }),
  scale: input('小数点位数', 'Portal数字输入框', { type: 'integer', constraints: ['0至4整数'] }),
  carryRule: input('进位规则枚举', 'Portal进位规则下拉框', { type: 'integer', options: [{ value: 1, label: '四舍五入' }, { value: 2, label: '向上取整' }, { value: 3, label: '向下取整' }] }),
  remark: optional('备注', 'Portal备注输入框', 'SDK补空字符串', { type: 'string | null', nullable: true, constraints: ['最多200字符；非空时不能全为空格'] }),
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/hr/manage/salary/list.vue 与 [mode]/[id].vue、common/salary/options.js', kind: 'reference', note: '证明列表筛选、批量删除、创建/编辑路由、表单默认值、条件必填、公式校验和POST/PUT/DELETE请求；固定检出未pull。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 SalaryItemController、SalaryItemDTO、SalaryItemEntity', kind: 'reference', note: '证明page/getAllSalaryItem/checkFormula、保存/修改/批量删除端点及字段；固定检出未pull。' },
  { source: 'src/capabilities/salary-item.ts', kind: 'implementation', note: '证明SDK的表单联动、请求顺序、ID校验和响应字段。' },
  { source: 'test/salary-item.test.ts', kind: 'test', note: '离线锁定页面请求、动态表单字段、公式预校验、批量删除、权限声明和坏响应。' },
]
const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  whenToUse: '操作Portal“薪资项目”列表及其创建/编辑表单。',
  boundaries: ['能力归属于人力系统薪资项目菜单；不把薪资账套内项目当成同一页面能力。', 'attribute、type、carryRule是枚举值，不接受标签、行号或名称代替；parameter是系统参数ID。', '页面没有删除前业务占用检查或恢复接口；删除结果需查询确认，不能把请求完成当成回查证据。'],
  prerequisites: ['已创建带有效会话token、tenantId和薪资项目页面上下文的SDK。', '写入前保留用户确认的完整表单；修改不得只传差异字段。'],
  failures: ['字段校验、公式校验、权限、网络或响应形状错误原样抛出；不能返回空列表冒充失败。', '写入超时结果不确定，先用get/list核对，不自动重复创建或删除。'],
  evidence,
  gaps: ['未启动浏览器、未在真实测试环境执行读请求或prepare→submit→cancel写闭环；当前契约来自固定Portal/Java源码和离线测试。', 'Portal/Java固定检出未按任务约束pull到远端最新，部署版本差异未验证。'],
  ...value,
})

const RAW: Record<string, AiContract> = {
  'salary-item-list': base({ purpose: '按属性、类型和名称查询薪资项目分页。', effect: 'read', inputs: queryInputs, output: listOutput, consume: ['按total分页并展示name、attribute、type、isMust、scale、carryRule、remark；保留list[].id用于后续动作。'], steps: [{ role: 'optional', when: '需要编辑某条记录', capabilityId: 'salary-item-get', mapping: { id: 'result.list[].id' }, instruction: '用户选定记录后读取同一ID的完整表单。' }], completion: '返回当前筛选页和total。', idempotency: null }),
  'salary-item-get': base({ purpose: '读取薪资项目编辑表单的当前值。', effect: 'read', inputs: { id: input('薪资项目主键', 'salary-item-list.list[].id', { type: 'string | number', constraints: idRules }) }, output: rowOutput, consume: ['以详情的完整字段为基础修改；不要用列表显示文本推断公式或系统参数。'], steps: [{ role: 'optional', when: '用户确认修改当前表单', capabilityId: 'salary-item-update', mapping: { id: 'result.id', name: 'result.name', isMust: 'result.isMust', attribute: 'result.attribute', formula: 'result.formula', parameter: 'result.parameter', type: 'result.type', scale: 'result.scale', carryRule: 'result.carryRule', remark: 'result.remark' }, instruction: '完整传递未修改字段；根据attribute重新确认formula/parameter条件。' }], completion: '获得与Portal编辑页一致的字段快照。', idempotency: null }),
  'salary-item-all': base({ purpose: '读取公式编辑器使用的全部薪资项目候选。', effect: 'read', inputs: {}, output: { shape: 'array', fields: [field('$', 'array', '全部薪资项目候选'), field('[]', 'object', '一条薪资项目候选'), ...rowFields('[]')], empty: '[]表示服务端没有可供公式引用的薪资项目。' }, consume: ['公式编辑器展示name；不要把候选数组下标写入formula。'], steps: [], completion: '获得公式变量候选。', idempotency: null }),
  'salary-item-check-formula': base({ purpose: '按Portal编辑表单规则校验一个非空薪资项目公式。', effect: 'read', inputs: { formula: input('待校验公式原文', 'Portal公式编辑器', { type: 'string', constraints: ['不能为空；具体变量和语法由后端校验'] }) }, output: voidOutput, consume: ['只有校验请求成功后才继续create或update；失败信息不能吞掉。'], steps: [], completion: '请求完成表示后端接受公式校验。', idempotency: null }),
  'salary-item-create': base({ purpose: '创建一个薪资项目。', effect: 'write', inputs: draftInputs, output: voidOutput, consume: ['创建成功后按精确名称分页查询，并核对attribute、type、scale、carryRule和remark；成功响应不包含新ID。'], steps: [{ role: 'required', when: '创建请求完成或超时', capabilityId: 'salary-item-list', mapping: { name: 'args.name' }, instruction: '逐页寻找精确名称并核对完整字段，多个匹配时不能猜测哪一条是本次创建。' }, { role: 'cancel', when: '用户在prepare阶段取消', instruction: '丢弃表单草稿，不调用create。' }], completion: '请求未抛错且查询回查确认目标记录。', idempotency: '后端没有requestId；重试可能产生重复记录，超时先list核实，不能自动重发。' }),
  'salary-item-update': base({ purpose: '修改一个已存在薪资项目的完整表单。', effect: 'write', inputs: { id: input('薪资项目主键', 'salary-item-get.id', { type: 'string | number', constraints: idRules }), ...draftInputs }, output: voidOutput, consume: ['修改请求完整发送Portal表单字段；完成后用同一ID get逐字段核对。'], steps: [{ role: 'required', when: '修改请求完成或超时', capabilityId: 'salary-item-get', mapping: { id: 'args.id' }, instruction: '核对name、isMust、attribute、formula、parameter、type、scale、carryRule、remark；不一致时报告未完成。' }, { role: 'cancel', when: '用户在prepare阶段取消', instruction: '丢弃修改草稿，不调用update。' }], completion: '请求未抛错且get回查字段一致。', idempotency: '后端没有requestId；同一完整状态重复PUT通常是覆盖写，超时仍先get确认，不能盲目重试。' }),
  'salary-item-prepare-remove': base({ purpose: '准备一批薪资项目删除ID，等待用户确认。', effect: 'prepare', inputs: { ids: input('待删除薪资项目ID数组', 'salary-item-list.list[].id', { type: 'array', constraints: idRules }) }, output: prepareRemoveOutput, consume: ['展示去重后的ID与对应列表行；用户取消时不调用remove。'], steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'salary-item-remove', mapping: { ids: 'result.ids' }, instruction: '只提交用户确认的同一批ID。' }, { role: 'cancel', when: '用户取消删除确认', instruction: '丢弃ids草稿，不发DELETE。' }], completion: '获得无副作用删除草稿。', idempotency: null }),
  'salary-item-remove': base({ purpose: '按Portal批量删除请求删除一批薪资项目。', effect: 'write', inputs: { ids: input('待删除薪资项目ID数组', 'salary-item-prepare-remove.ids或salary-item-list.list[].id', { type: 'array', constraints: idRules }) }, output: voidOutput, consume: ['完成后按相同筛选条件逐页确认这些ID不再出现；后端业务限制失败时保留原错误。'], steps: [{ role: 'required', when: '删除请求完成或超时', capabilityId: 'salary-item-list', mapping: {}, instruction: '使用删除前的筛选条件逐页回查；没有独立删除回执时不能仅凭Promise完成报告已删除。' }], completion: '请求未抛错且回查确认目标ID消失。', idempotency: '删除没有requestId且不可恢复；超时先list核实，不能自动重放。' }),
}

export const SALARY_ITEM_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALARY_ITEM_METHODS).map(id => [id, RAW[id]!]))
export const SALARY_ITEM_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALARY_ITEM_METHODS).map(([id, method]) => [`salaryItem.${method}`, SALARY_ITEM_AI_CONTRACTS[id]!]))
