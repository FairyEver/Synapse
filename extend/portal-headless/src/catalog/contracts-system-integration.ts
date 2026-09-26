import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SYSTEM_INTEGRATION_METHODS, systemIntegrationCapabilities } from '../capabilities/system-integration.js'

const definitions = new Map(systemIntegrationCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const flags = [
  field('hrEnabled', '0 | 1 | null', '人力模块开关；1/true 表示开启，0/false 表示关闭，null 表示后端未提供该字段', { values: { '0': '关闭', '1': '开启' } }),
  field('financeEnabled', '0 | 1 | null', '财务模块开关；1/true 表示开启，0/false 表示关闭，null 表示后端未提供该字段', { values: { '0': '关闭', '1': '开启' } }),
  field('inventoryEnabled', '0 | 1 | null', '物料模块开关；1/true 表示开启，0/false 表示关闭，null 表示后端未提供该字段', { values: { '0': '关闭', '1': '开启' } }),
  field('productionEnabled', '0 | 1 | null', '生产模块开关；它是系统开通页面的一个字段，不代表 SDK 实现了独立生产根模块', { values: { '0': '关闭', '1': '开启' } }),
  field('supplyEnabled', '0 | 1 | null', '供应模块开关；1/true 表示开启，0/false 表示关闭，null 表示后端未提供该字段', { values: { '0': '关闭', '1': '开启' } }),
  field('salesEnabled', '0 | 1 | null', '销售模块开关；1/true 表示开启，0/false 表示关闭，null 表示后端未提供该字段', { values: { '0': '关闭', '1': '开启' } }),
]
const rowFields = [
  field('id', 'string | number', '系统开通配置记录主键；Long 可能序列化为字符串，回查时原样保留'),
  field('orgId', 'string | number', '组织ID；列表编辑和保存的目标组织'),
  field('orgName', 'string | null', '组织名称；null 表示后端未返回名称', { nullable: true, nullMeaning: '后端未返回组织名称' }),
  field('orgFullPath', 'string | null', '组织全路径；用于区分同名组织', { nullable: true, nullMeaning: '后端未返回组织全路径' }),
  ...flags,
  field('remark', 'string | null', '备注；null 表示后端未返回备注，不等同于用户输入的空字符串', { nullable: true, nullMeaning: '后端未返回备注' }),
  field('createTime', 'string | number | null', '创建时间原值；SDK 不转换时区', { nullable: true, nullMeaning: '后端未返回创建时间' }),
  field('updateTime', 'string | number | null', '更新时间原值；SDK 不转换时区', { nullable: true, nullMeaning: '后端未返回更新时间' }),
]
const formFields = [
  field('id', 'string | number', '编辑详情中的配置记录主键；创建表单没有该字段'),
  field('orgId', 'string | number', '组织ID；创建必填，编辑时沿用详情值'),
  field('orgName', 'string | null', '组织名称；页面编辑时展示且禁用', { nullable: true }),
  field('orgFullPath', 'string | null', '组织全路径；页面用于识别组织', { nullable: true }),
  ...flags.map(item => ({ ...item, type: 'boolean', meaning: item.meaning.replace('0/1/null', 'false/true') })),
  field('remark', 'string', '备注；详情 null 会归一为空字符串，提交最多200个字符'),
]
const draftFields = [
  field('draft', 'object', '尚未发送请求的完整 batch-config 草稿'),
  field('draft.orgId', 'string | number', '保存目标组织ID'),
  ...flags.map(item => ({ ...item, path: `draft.${item.path}`, type: '0 | 1', nullable: false, meaning: item.meaning.split('；')[0] + '；提交时固定为0或1' })),
  field('draft.remark', 'string', '提交备注；缺省归一为空字符串，最多200个字符'),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页系统开通配置记录'), field('total', 'number', '符合组织筛选条件的总记录数，不是当前页长度'), ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[] 且 total=0 表示当前筛选没有记录；权限、网络或响应形状错误会抛出，不能把空页解释成没有权限。',
}
const formOutput: AiContract['output'] = {
  shape: 'object',
  fields: formFields,
  empty: '详情必须是对象；空响应或缺少组织/记录主键会抛错，不把不存在的配置伪装成六个关闭开关。',
}
const preparationOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: draftFields,
  empty: 'prepare 只返回内存草稿，不代表服务端已经保存；取消时直接丢弃草稿。',
}
const countOutput: AiContract['output'] = {
  shape: 'number',
  fields: [field('$', 'number', '后端实际影响的组织配置条数；非负整数，可能包含目标组织的级联子孙组织')],
  empty: '0 表示后端返回影响条数为零，仍需按组织ID回查确认最终状态；不能把数字回执当作详情。',
}

const evidence: AiContract['evidence'] = [
  { source: 'Portal test/portal/main@acab69acc77b6d6c0da21310cdfd26b91a01641e4：app/portal/views/dashboard/hr/setting/integration/list.vue 与 [mode]/[id].vue', kind: 'reference', note: '核对页面菜单权限、platform 请求实例、page/get/batch-config 端点、limit 分页、六个开关和备注校验。' },
  { source: 'Java test/test@0f1a55718ebc1987affb8bf245106e809dd51da4：OrgModuleSwitchController、OrgModuleSwitchBatchConfigReqVO、OrgModuleSwitchRespVO', kind: 'reference', note: '核对请求字段、响应字段、保存返回影响条数及级联组织副作用。' },
  { source: 'src/capabilities/system-integration.ts 与 test/system-integration.test.ts', kind: 'implementation', note: '锁定 SDK 最终请求投影、0/1 转换、分页响应校验、保存回执和反证。' },
  { source: 'docs/pages/系统开通.md', kind: 'reference', note: '记录本页四件套和未实测项。' },
]

const definitionsById = (id: string) => {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`System integration contract has no definition: ${id}`)
  return definition
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitionsById(id)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: parameter.name === 'form' || parameter.name === 'draft' ? 'object' : parameter.kind === 'number' ? 'number' : 'string | number',
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: '用户给出的系统开通页面条件或表单值；类型、默认值和校验按本页 Portal 规则。',
  }]))
}

const contracts: Record<string, AiContract> = {}
function add (id: string, value: Omit<AiContract, 'inputs'> & { inputs?: Record<string, AiParameter> }): void {
  definitionsById(id)
  contracts[id] = { ...value, inputs: { ...inputsOf(id), ...value.inputs } }
}

const boundaries = [
  '只覆盖保留范围内的“系统设置 → 系统开通”页面（/dashboard/setting/integration/list）及其列表、创建和编辑表单；独立生产、财务、资产、采购、销售根模块不在本页实现范围内。',
  'productionEnabled 只是本页六个集成开关之一，不是独立生产模块能力；不要据此路由到生产页面或宣称覆盖生产业务。',
  '页面使用 platform 实例；本页 module-type 规则为空，SDK 不发送 module-type。调用仍受会话、租户和后端权限控制，不能用页面权限字符串绕过403。',
  '组织树是 Portal 的无界全量组织树支撑控件，SDK 不发布该树的独立大结果能力；调用方应从已知组织上下文、列表或详情取得 orgId。',
  'Java 中存在但当前页面没有调用的 /list 与 /batch-config-by-string，以及页面没有的删除、导出、回滚接口，不属于本页能力。',
]
const base = (id: string, purpose: string, effect: AiContract['effect'], output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void => {
  add(id, {
    purpose,
    whenToUse: `当需要${purpose.replace(/[。；].*$/, '')}时使用本页能力。`,
    boundaries,
    effect,
    prerequisites: ['使用当前用户会话 token、当前租户和系统开通页面权限；组织ID必须来自当前业务上下文，不凭名称猜ID。'],
    output,
    consume,
    steps: [],
    completion: '按输出契约解释结果；写入能力必须在返回或超时后回查目标组织的详情/列表，不能只凭HTTP成功或影响条数报告完成。',
    failures: ['orgId、表单字段、备注长度或响应形状不符合Portal规则时修正输入；403按页面/后端权限处理；写入超时先回查，不盲目重发。'],
    idempotency: null,
    evidence,
    gaps: ['已完成 Portal/Java 源码核对和离线请求反证；尚未在真实测试环境执行本页读请求，也未执行真实写入的 prepare → submit → cancel/回滚记录。'],
    ...extra,
  })
}

base('system-integration-list', '查询系统开通组织模块配置分页', 'read', listOutput, [
  '按 list[].orgId 选择编辑目标；展示六个开关时，严格把1或true解释为开启，0或false解释为关闭，null保留为后端缺失。',
  '分页请求使用 Portal 的 order=""、orderField=""、pageNo 和 limit；limit 只取10、20、50、100，默认20。',
], { steps: [{ role: 'optional', when: '用户选择某行编辑', capabilityId: 'system-integration-get', mapping: { orgId: 'result.list[].orgId' }, instruction: '按同一组织ID读取编辑表单，不直接用列表行拼接保存数据。' }] })

base('system-integration-get', '读取一个组织的系统开通编辑表单', 'read', formOutput, [
  'SDK 将后端六个0/1开关按 Portal normalizeFromApi 规则转换为布尔值；remark 的 null/缺省转换为空字符串，组织名称和全路径保留原值。',
  '详情中的 id 是配置记录主键，orgId 是保存目标组织ID；两者不能互换。',
], { inputs: { orgId: param('编辑目标组织ID。', 'system-integration-list.list[].orgId 或已知组织上下文', { required: true, type: 'string | number' }) }, steps: [{ role: 'optional', when: '用户确认修改表单', capabilityId: 'system-integration-prepare-update', instruction: '将本次详情和用户明确修改交给prepareUpdate；不要跳过详情读取。' }] })

base('system-integration-prepare-create', '校验系统开通创建表单并生成完整保存草稿', 'prepare', preparationOutput, [
  'prepare 不发请求；用户取消时丢弃 draft。orgId 必填，六个开关缺省按关闭处理，remark 缺省按空字符串处理且最多200个字符。',
], { inputs: { form: param('创建表单；至少含orgId，六个开关可填布尔值或0/1，remark可空。', '用户明确的系统开通配置意图', { required: true, type: 'object', constraints: ['orgId为正整数ID', 'remark长度不超过200'] }) }, steps: [{ role: 'required', when: '用户确认创建', capabilityId: 'system-integration-create', mapping: { draft: 'result.draft' }, instruction: '只提交prepare返回的完整draft；成功或超时后按orgId回查。' }, { role: 'cancel', when: '用户取消创建', instruction: '丢弃draft，不调用batch-config；本页没有服务端取消接口。' }], completion: '得到只含batch-config允许字段、尚未写入的0/1草稿。', idempotency: null })

base('system-integration-create', '提交一份系统开通组织配置', 'write', countOutput, [
  '请求体严格是 orgId、hrEnabled、financeEnabled、inventoryEnabled、productionEnabled、supplyEnabled、salesEnabled、remark 八个字段，六个开关固定为0/1；不会发送表单展示字段orgName/orgFullPath/id。',
  '后端可能对目标组织及其子孙组织执行upsert，返回数字是实际影响条数，不是新记录详情。',
], { inputs: { draft: param('system-integration-prepare-create 返回的完整草稿。', 'system-integration-prepare-create.draft', { required: true, type: 'object' }), 'draft.orgId': param('创建草稿中的目标组织ID。', 'system-integration-prepare-create.draft.orgId', { required: true, type: 'string | number' }) }, steps: [{ role: 'required', when: '保存成功或响应超时', capabilityId: 'system-integration-get', mapping: { orgId: 'args.draft.orgId' }, instruction: '按同一orgId读取详情，逐字段核对六个开关和remark；必要时再用list核对影响范围。' }, { role: 'cancel', when: '用户在prepare阶段取消', instruction: '不调用create；已提交后没有Portal撤销/回滚接口。' }], completion: 'get回查确认目标组织字段一致，并解释可能的级联影响后报告创建完成。', idempotency: '后端没有requestId；响应不确定时先按orgId回查，不能盲目重复提交。' })

base('system-integration-prepare-update', '校验系统开通编辑表单并生成完整保存草稿', 'prepare', preparationOutput, [
  '编辑必须带get返回的id；id只用于确认编辑上下文，实际batch-config请求仍以orgId定位并提交完整八字段。',
  'prepare 不发请求；用户取消时丢弃 draft，不会调用任何回滚接口。',
], { inputs: { form: param('最新system-integration-get返回的编辑表单，叠加用户明确修改。', 'system-integration-get.result 与用户编辑意图', { required: true, type: 'object' }) }, steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'system-integration-update', mapping: { draft: 'result.draft' }, instruction: '只提交prepare返回的完整draft；保存后按orgId回查。' }, { role: 'cancel', when: '用户取消编辑', instruction: '丢弃draft，不发batch-config；已提交后没有Portal撤销/回滚能力。' }], completion: '得到包含六个0/1开关和remark的尚未写入草稿。', idempotency: null })

base('system-integration-update', '保存一个已有组织的系统开通配置', 'write', countOutput, [
  '与Portal编辑页一致，保存不是差异更新；必须发送六个开关和remark的完整绝对值。',
  '成功或超时后必须用system-integration-get按draft.orgId回查；影响条数只说明后端处理数量，不能替代字段核对。',
], { inputs: { draft: param('system-integration-prepare-update 返回的完整编辑草稿。', 'system-integration-prepare-update.draft', { required: true, type: 'object' }), 'draft.orgId': param('编辑草稿中的目标组织ID。', 'system-integration-prepare-update.draft.orgId', { required: true, type: 'string | number' }) }, steps: [{ role: 'required', when: '保存成功或响应超时', capabilityId: 'system-integration-get', mapping: { orgId: 'args.draft.orgId' }, instruction: '按orgId逐字段核对最终六开关和remark，超时未核实前不重复提交。' }, { role: 'cancel', when: '用户在prepare阶段取消', instruction: '不调用update；已写入没有Portal撤销/回滚接口。' }], completion: 'get回查结果与目标草稿一致后，才报告编辑完成。', idempotency: '后端没有requestId；这是绝对值写入，超时先回查，不盲目覆盖他人修改。' })

export const SYSTEM_INTEGRATION_AI_CONTRACTS = contracts
export const SYSTEM_INTEGRATION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SYSTEM_INTEGRATION_METHODS).map(([id, method]) => [`systemIntegration.${method}`, { ...SYSTEM_INTEGRATION_AI_CONTRACTS[id]!, boundaries: [...SYSTEM_INTEGRATION_AI_CONTRACTS[id]!.boundaries, `直接方法使用 sdk.systemIntegration.${method} 的参数契约；prepare 只产生draft，create/update才发batch-config。`] }]),
)
