import { ALL_CAPABILITY_DEFINITIONS } from '../capabilities/index.js'
import { CONTRACT_CODE_RULE_METHODS } from '../capabilities/contract-code-rule.js'
import type { AiContract, AiField, AiParameter } from './ai-contract.js'

const definitions = new Map(ALL_CAPABILITY_DEFINITIONS.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main@acab69acc77b6d6c0da21310cdfd26b91a01641e：app/portal/views/dashboard/hr/contract/code-rule/list.vue、contract/utils/index.js',
    kind: 'reference',
    note: '核对页面权限、当前规则读取、创建/更新分支、表单必填、字段选项和本地预览格式。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test@0f1a55718ebc1987affb8bf245106e809dd51da4：ContractCodeRuleController、ContractCodeRuleSaveReqVO、ContractCodeRuleDO、ContractCodeRuleServiceImpl',
    kind: 'reference',
    note: '核对规则端点、请求字段、创建ID/更新true回执和按租户读取最新规则。',
  },
  {
    source: 'src/capabilities/contract-code-rule.ts、test/contract-code-rule.test.ts',
    kind: 'test',
    note: '锁定SDK最终请求、前端表单边界、预览格式、创建/更新响应和零请求反证。',
  },
]

const failures = [
  '会话失效、页面权限、租户数据范围、网络或标准响应失败都抛异常；空规则只表示当前租户尚未配置，不是权限成功。',
  '固定前缀、日期格式和流水号长度不符合Portal表单规则时，在请求前失败；不要用显示名称替代枚举值。',
]

function definitionOf (id: string) {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`缺少合同编码规则能力定义：${id}`)
  return definition
}

function inputsOf (id: string, overrides: Record<string, AiParameter> = {}): Record<string, AiParameter> {
  const definition = definitionOf(id)
  const inputs: Record<string, AiParameter> = {}
  for (const item of definition.params) {
    inputs[item.name] = param(item.description ?? item.name, `Portal合同编码规则${item.name}参数；按页面源码原值填写。`, {
      type: item.kind === 'number' ? 'number' : item.kind === 'date' ? 'string' : 'string',
      required: item.required,
      ...(item.options ? { options: item.options } : {}),
    })
  }
  return { ...inputs, ...overrides }
}

function base (id: string, purpose: string, output: AiContract['output'], extra: Partial<AiContract> = {}): AiContract {
  const definition = definitionOf(id)
  return {
    purpose,
    whenToUse: purpose,
    effect: definition.write ? 'write' : 'read',
    boundaries: [
      '能力归属Portal“合同编码规则”页面，页面权限码为/dashboard/contract/code-rule；使用platform实例并实际发送module-type=15（风险防控）。',
      '页面只有一条当前租户规则表单；SDK不把通用分页、删除、导出接口加入本页，因为当前Portal页面没有调用这些入口。',
    ],
    prerequisites: ['使用同一Portal用户/租户会话；写入前确认用户明确要变更后续新合同的编码规则。'],
    inputs: inputsOf(id),
    output,
    consume: ['保留id、日期格式和流水号长度的原始语义；写入成功或超时后回到get核对当前规则。'],
    steps: [],
    completion: definition.write ? '得到成功回执并完成get回查；只收到HTTP成功不能代替持久化证据。' : '得到当前规则或本地草稿；不自动触发未声明的写操作。',
    failures,
    idempotency: definition.write ? '后端没有requestId；创建/更新结果不确定时先get回查，不盲目重放。' : null,
    evidence,
    ...extra,
  }
}

const draftFields: AiField[] = [
  field('id', 'string | number | null', '规则主键；新建草稿固定为null，更新草稿必须保留当前规则ID', { nullable: true, nullMeaning: '新建尚未落库' }),
  field('fixedPrefix', 'string', '编码固定前缀；页面必填，最多6个字符，提交时保留原输入值'),
  field('dateStyle', 'number', '日期格式：1=年(YYYY)、2=年-月(YYYYMM)、3=年-月-日(YYYYMMDD)', { values: { '1': '年', '2': '年-月', '3': '年-月-日' } }),
  field('serialLength', 'number', '随机流水号长度，只能是4、6或8', { values: { '4': '4位', '6': '6位', '8': '8位' } }),
  field('description', 'string | null', '规则描述；页面未设置长度限制，按原值保存', { nullable: true, nullMeaning: '没有描述' }),
]

const ruleFields: AiField[] = [
  ...draftFields,
  field('createTime', 'string | number | null', '后端创建时间原值；SDK不自行换算时区', { optional: true, nullable: true, nullMeaning: '响应未返回创建时间' }),
]

const draftParam = (source: string): AiParameter => param('完整合同编码规则草稿；不能只提交差异字段。', source, { type: 'object', required: true })

const contracts: Record<string, AiContract> = {}

contracts['contract-code-rule-get'] = base('contract-code-rule-get', '读取当前租户的合同编码规则。', {
  shape: 'object | null',
  fields: ruleFields,
  empty: '返回null表示当前租户还没有规则，Portal随后进入创建分支；不要把null当成请求失败。',
}, {
  consume: ['若结果为null，向用户确认后调用contract-code-rule-prepare-create；若有id，保存完整对象作为prepare-update的draft。'],
  steps: [
    { role: 'optional', when: '当前规则不存在且用户确认创建', capabilityId: 'contract-code-rule-prepare-create', mapping: { fixedPrefix: 'user.fixedPrefix', dateStyle: 'user.dateStyle', serialLength: 'user.serialLength', description: 'user.description' }, instruction: '按页面必填和选项生成id=null的新建草稿。' },
    { role: 'optional', when: '当前规则存在且用户确认编辑', capabilityId: 'contract-code-rule-prepare-update', mapping: { draft: 'result.$' }, instruction: '以完整当前规则为草稿，只允许用户明确修改表单字段。' },
  ],
  completion: '得到当前规则对象或明确的未配置状态；读取本身不改变数据。',
})

contracts['contract-code-rule-prepare-create'] = base('contract-code-rule-prepare-create', '在创建合同编码规则前按Portal表单规则生成无副作用草稿。', {
  shape: 'object',
  fields: draftFields,
  empty: 'fixedPrefix为空/超过6字符、dateStyle不在1/2/3或serialLength不在4/6/8时抛错，不发请求。',
}, {
  effect: 'prepare',
  idempotency: null,
  inputs: inputsOf('contract-code-rule-prepare-create', {
    fixedPrefix: param('固定前缀；不能为空且最多6个字符。', '用户在Portal“固定前缀”输入框的明确输入', { type: 'string', required: true, constraints: ['保留输入值，不用显示名称替换'] }),
    dateStyle: param('日期格式枚举：1年、2年-月、3年-月-日。', '用户在Portal“日期格式”选择器的明确选择', { type: '1 | 2 | 3', required: true }),
    serialLength: param('流水号长度枚举：4、6或8。', '用户在Portal“流水号长度”选择器的明确选择', { type: '4 | 6 | 8', required: true }),
  }),
  consume: ['把草稿展示给用户确认；确认后将同一草稿传给create，取消只丢弃草稿。'],
  steps: [{ role: 'required', when: '用户确认创建', capabilityId: 'contract-code-rule-create', mapping: { draft: 'result.$' }, instruction: '只提交prepare返回的完整草稿；创建返回ID后调用get回查。' }],
  completion: '得到id=null的新建草稿，尚未写入后端。',
})

contracts['contract-code-rule-create'] = base('contract-code-rule-create', '创建当前租户的合同编码规则。', {
  shape: 'string | number',
  fields: [field('$', 'string | number', '后端新建规则ID')],
  empty: '没有有效ID或请求抛错不能报告创建成功。',
}, {
  inputs: { draft: draftParam('contract-code-rule-prepare-create.result') },
  consume: ['Portal创建成功后刷新当前规则；SDK调用方必须按返回ID和get结果核对固定前缀、日期格式、流水号长度和描述。'],
  steps: [{ role: 'required', when: '创建成功或响应超时', capabilityId: 'contract-code-rule-get', instruction: '读取同一租户当前规则，确认新规则已成为页面显示的最新规则；超时先回查，不盲目重复创建。' }],
  completion: 'get回查确认当前规则字段与用户确认草稿一致。',
})

contracts['contract-code-rule-prepare-update'] = base('contract-code-rule-prepare-update', '在编辑合同编码规则前按Portal表单规则生成完整更新草稿。', {
  shape: 'object',
  fields: draftFields,
  empty: '缺少当前规则ID或表单字段不符合Portal规则时抛错，不发请求。',
}, {
  effect: 'prepare',
  idempotency: null,
  inputs: { draft: draftParam('contract-code-rule-get.result') },
  consume: ['将草稿展示给用户确认；取消只丢弃草稿，不调用update。'],
  steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'contract-code-rule-update', mapping: { draft: 'result.$' }, instruction: '提交完整含id草稿；成功或超时后调用get回查。' }],
  completion: '得到含当前规则ID的完整更新草稿，尚未写入后端。',
})

contracts['contract-code-rule-update'] = base('contract-code-rule-update', '保存当前租户已确认的合同编码规则编辑草稿。', {
  shape: 'boolean',
  fields: [field('$', 'boolean', '服务端true成功回执')],
  empty: '非true回执或请求异常不能报告更新成功。',
}, {
  inputs: { draft: draftParam('contract-code-rule-prepare-update.result') },
  consume: ['成功或超时后调用get逐字段核对；规则变更只影响后续新建合同，不会重编码历史合同。'],
  steps: [{ role: 'required', when: '更新请求完成或响应超时', capabilityId: 'contract-code-rule-get', instruction: '回查当前租户规则；不一致时报告未完成，不能直接重复PUT。' }],
  completion: 'get回查确认固定前缀、日期格式、流水号长度和描述已生效。',
})

contracts['contract-code-rule-preview'] = base('contract-code-rule-preview', '按Portal页面格式在本地生成合同编码规则预览。', {
  shape: 'string',
  fields: [field('$', 'string', '固定前缀 + 按dateStyle生成的日期文本 + 指定位数随机大写数字字母流水号')],
  empty: '输入不符合页面规则时抛错；该方法不发请求。',
}, {
  effect: 'local',
  idempotency: null,
  inputs: inputsOf('contract-code-rule-preview', {
    draft: draftParam('调用方当前编辑草稿'),
    date: param('预览日期；省略使用SDK运行时本地日期。', 'Portal页面的当前日期或调用方为可重复测试提供的日期', { type: 'string', required: false }),
    serial: param('可选固定流水号；省略时随机生成。', '调用方为可重复展示/测试提供的4/6/8位大写数字字母串', { type: 'string', required: false }),
  }),
  consume: ['预览只是本地显示，不代表规则已保存；用户确认后仍需prepareCreate/prepareUpdate和真实写操作。'],
  steps: [],
  completion: '得到页面同格式的本地示例编码；没有服务端副作用。',
})

export const CONTRACT_CODE_RULE_AI_CONTRACTS = contracts
export const CONTRACT_CODE_RULE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(CONTRACT_CODE_RULE_METHODS).map(([id, method]) => [
    `contractCodeRule.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法入口为sdk.contractCodeRule.${method}；仍需遵守当前规则页面的完整草稿与回查规则。`] },
  ]),
)
