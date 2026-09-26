import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { PLATFORM_RULE_MANAGEMENT_METHODS, PLATFORM_RULE_MANAGEMENT_SYSTEM_OPTIONS, platformRuleManagementCapabilities } from '../capabilities/platform-rule-management.js'

const definitions = new Map(platformRuleManagementCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const systemOptions = PLATFORM_RULE_MANAGEMENT_SYSTEM_OPTIONS.map(item => ({ label: item.label, value: item.value }))
const recordFields: AiField[] = [
  field('id', 'string | number', '规则主键；长整数保留原始字符串', { constraints: ['正整数'] }),
  field('ruleCode', 'string | null', '规则编码；创建时必须非空且由后端校验唯一', { nullable: true, nullMeaning: '后端未返回编码' }),
  field('ruleName', 'string | null', '规则名称；列表模糊筛选字段', { nullable: true, nullMeaning: '后端未返回名称' }),
  field('ruleExpression', 'string | null', 'QLExpress规则表达式；详情读取时会把后端返回的\\n/\\r转为真实换行', { nullable: true, nullMeaning: '后端未返回表达式' }),
  field('ruleDescription', 'string | null', '规则说明', { nullable: true, nullMeaning: '没有说明' }),
  field('ruleType', 'string | null', '规则类型字典值；页面来源为sales_rule_type', { nullable: true, nullMeaning: '未配置' }),
  field('ruleGroup', 'string | null', '规则分组字典值；页面来源为sales_rule_group', { nullable: true, nullMeaning: '未配置' }),
  field('enabled', 'boolean | null', '是否启用；true=启用、false=停用', { nullable: true, nullMeaning: '后端未返回状态' }),
  field('priority', 'integer | null', '优先级；数值越大优先级越高', { nullable: true, nullMeaning: '后端未返回优先级' }),
  field('systemType', 'string | number | null', '所属系统值；页面本地候选为科技8、公共0、人力1、财务2、资产3、生产4、采购5、销售6、门户7、平台10', { nullable: true, nullMeaning: '后端未返回系统类型' }),
  field('version', 'integer | null', '规则版本号', { nullable: true, nullMeaning: '后端未返回版本' }),
  field('updateTime', 'string | number | null', '更新时间原值', { nullable: true, nullMeaning: '后端未返回更新时间' }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('list', 'object[]', '当前页规则记录'),
    field('total', 'number', '符合当前筛选条件的总记录数'),
    ...recordFields.map(item => ({ ...item, path: `list[].${item.path}` })),
  ],
  empty: 'list=[]表示当前页没有记录；total=0表示当前筛选没有匹配项，不把空列表解释为权限成功或失败。',
}
const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: recordFields,
  empty: '规则不存在时请求失败；字段为null表示后端未配置或未返回，不要擅自补默认值。',
}
const validationOutput: AiContract['output'] = {
  shape: '{ valid: boolean, message: string | null, errors: string[] | null }',
  fields: [
    field('valid', 'boolean', '规则表达式是否通过安全和QLExpress语法校验'),
    field('message', 'string | null', '校验结果说明；失败时通常包含原因', { nullable: true, nullMeaning: '后端未返回说明' }),
    field('errors', 'string[] | null', '错误明细；当前后端常省略或返回空数组', { nullable: true, nullMeaning: '后端未返回错误数组' }),
  ],
  empty: 'valid=false仍是一次成功的校验结果，应展示message/errors；HTTP或权限失败才是请求失败。',
}
const draftOutput = (kind: 'create' | 'update'): AiContract['output'] => ({
  shape: '{ draft: object }',
  fields: [
    field('draft', 'object', `尚未提交的规则${kind === 'create' ? '创建' : '更新'}请求体`),
    ...(kind === 'update' ? [field('draft.id', 'string | number', '待更新规则ID', { constraints: ['正整数'] })] : []),
    field('draft.ruleCode', 'string', '规则编码；非空'),
    field('draft.ruleName', 'string', '规则名称；非空'),
    field('draft.ruleExpression', 'string', 'QLExpress规则表达式；非空，提交前可先调用validate'),
    field('draft.ruleDescription', 'string | null', '规则说明；空表单按空字符串提交', { nullable: true, nullMeaning: '调用方明确传null' }),
    field('draft.ruleType', 'string', 'sales_rule_type字典value；非空'),
    field('draft.ruleGroup', 'string', 'sales_rule_group字典value；非空'),
    field('draft.enabled', 'boolean', '是否启用'),
    field('draft.priority', 'integer', '优先级；页面要求整数'),
    field('draft.systemType', 'string | number', 'SYSTEM_OPTIONS_ALL中的所属系统值'),
    field('draft.version', 'integer', '规则版本号；页面要求整数'),
  ],
  empty: 'prepare只返回本地草稿，不代表服务端已写入；取消时丢弃draft且不发请求。',
})
const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [],
  empty: '成功没有业务返回值；必须用get/list回查确认写入，HTTP错误或后端规则校验错误会抛出。',
}

const readGaps = [
  '本轮已逐页核对Portal列表/表单源码、Java Controller/DTO/Service、SDK实现和离线请求断言；尚未在真实测试环境执行浏览器读操作。',
]
const writeGaps = [
  ...readGaps,
  '本轮未在真实测试环境执行创建/编辑的prepare → submit → cancel完整记录；页面和后端均没有可达的撤销规则接口，取消仅代表丢弃本地draft。',
]

function typeOf (kind: string): string {
  if (kind === 'number') return 'number'
  if (kind === 'boolean') return 'boolean'
  if (kind === 'enum') return 'string | number'
  return 'string'
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Platform rule management contract has no definition: ${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: typeOf(parameter.kind),
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: '用户提供的Portal规则管理查询、表达式或表单数据；候选和必填规则以页面源码为准。',
    ...(parameter.options ? { options: parameter.options } : {}),
  }]))
}

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/views/dashboard/platform/system/express/list.vue 与 [mode]/[id].vue', kind: 'reference', note: '逐字段核对列表筛选、cleanParams、详情GET、create/update提交、validate动作和取消/返回行为。' },
  { source: 'RuleManagementController、RuleDefinitionPageReqVO、RuleDefinitionSaveReqVO、RuleValidateReqVO、RuleDefinitionServiceImpl', kind: 'reference', note: '核对后端字段、分页筛选、规则表达式校验、唯一编码、超级管理员写权限和响应形状。' },
  { source: 'src/capabilities/platform-rule-management.ts 与 test/platform-rule-management.test.ts', kind: 'implementation', note: '核对SDK最终请求体、缺省参数过滤、表达式换行归一、权限边界和反证测试。' },
  { source: 'docs/pages/规则管理.md', kind: 'reference', note: '记录页面四件套、实测缺口和未暴露的后端接口。' },
]

const contracts: Record<string, AiContract> = {}
function add (id: string, purpose: string, effect: AiContract['effect'], output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Platform rule management contract has no definition: ${id}`)
  const write = definition.write
  contracts[id] = {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '页面路径是 /dashboard/platform/system/express/list，权限码是 /dashboard/platform/system/express；请求走platform实例，Portal当前没有为该路径计算出module-type，因此不发送该头。',
      '列表的空字符串/null筛选按Portal cleanParams过滤；enabled省略时Java接口会默认设为true，只代表后端默认查询启用规则。',
      '规则类型和分组下拉使用base-dict-get分别读取sales_rule_type与sales_rule_group；systemType不是字典，候选固定来自页面SYSTEM_OPTIONS_ALL。',
      'create/update虽然页面可见，但Java后端额外要求当前登录用户是超级管理员；菜单可见不等于具备写权限，403必须作为失败处理。',
      'Portal当前页面没有删除、规则执行测试、运行引擎测试、类型/分组接口入口，SDK不把这些后端接口冒充本页能力。',
      'validate只校验表达式，不创建或修改规则；valid=false是业务校验结果，不是HTTP请求失败。',
    ],
    effect,
    prerequisites: ['用会话token和租户创建SDK；先list/get取得待编辑规则的完整ID和字段；写操作先确认调用身份是超级管理员。'],
    inputs: inputsOf(id),
    output,
    consume,
    steps: [],
    completion: write ? '请求成功后必须用get/list逐字段回查；prepare成功只表示本地草稿合法。' : '返回值符合当前Portal页面接口语义；请求失败或权限失败必须抛出。',
    failures: ['必填字段为空、数字字段非整数、表达式为空会在SDK侧拒绝；字典值、表达式语法、规则编码唯一性和超级管理员校验由后端继续判断。', '请求超时先get/list核对，不盲目重复创建或覆盖更新。'],
    idempotency: write ? '后端没有requestId或撤销接口；create超时先按ruleCode回查，update超时先按id回查。' : null,
    evidence,
    gaps: write ? [...writeGaps] : [...readGaps],
    ...extra,
  }
}

add('platform-rule-management-list', '分页读取Portal规则管理列表。', 'read', listOutput, ['使用list[].id进入get或编辑；使用ruleCode、ruleType、ruleGroup、enabled和systemType解释展示字段。'])
add('platform-rule-management-get', '读取一条规则的详情和编辑表单字段。', 'read', detailOutput, ['读取ruleExpression时直接消费SDK已归一的真实换行；修改前保留id和全部表单字段。'])
add('platform-rule-management-validate', '调用Portal规则语法验证动作，检查表达式安全性和QLExpress语法。', 'read', validationOutput, ['valid=true才允许继续准备提交；valid=false展示message/errors并修正表达式，不调用create/update。'])
add('platform-rule-management-prepare-create', '按Portal新建表单规则生成规则创建草稿，不发网络请求。', 'prepare', draftOutput('create'), ['用户确认后把result.draft原样交给platformRuleManagement.create；取消只丢弃draft。'], { steps: [{ role: 'optional', when: '提交前检查表达式', capabilityId: 'platform-rule-management-validate', mapping: { expression: 'result.draft.ruleExpression' }, instruction: '仅当valid=true时继续提交。' }, { role: 'required', when: '用户确认创建', capabilityId: 'platform-rule-management-create', mapping: { draft: 'result.draft' }, instruction: '提交同一draft；成功或超时后按ruleCode回查list并用get确认详情。' }, { role: 'cancel', when: '用户取消创建', instruction: '丢弃draft，不调用create。' }] })
add('platform-rule-management-create', '创建一条Portal规则定义。', 'write', voidOutput, ['成功或超时后调用list按ruleCode核对新记录，再用get按id核对表达式、启用状态、优先级、系统类型和版本。'], { steps: [{ role: 'required', when: '返回成功或请求超时', capabilityId: 'platform-rule-management-list', mapping: { ruleCode: 'args.draft.ruleCode' }, instruction: '按完整ruleCode回查；不要只依据无业务返回值判断已创建。' }] })
add('platform-rule-management-prepare-update', '按Portal编辑表单规则生成规则更新草稿，不发网络请求。', 'prepare', draftOutput('update'), ['用户确认后把result.draft原样交给platformRuleManagement.update；取消只丢弃draft。'], { steps: [{ role: 'optional', when: '提交前检查表达式', capabilityId: 'platform-rule-management-validate', mapping: { expression: 'result.draft.ruleExpression' }, instruction: '仅当valid=true时继续提交。' }, { role: 'required', when: '用户确认编辑', capabilityId: 'platform-rule-management-update', mapping: { draft: 'result.draft' }, instruction: '提交同一draft；成功或超时后按id调用get核对。' }, { role: 'cancel', when: '用户取消编辑', instruction: '丢弃draft，不调用update。' }] })
add('platform-rule-management-update', '提交一条已有规则的编辑结果。', 'write', voidOutput, ['成功或超时后调用get按id核对规则名称、表达式、描述、类型、分组、启用状态、优先级、系统类型和版本。'], { steps: [{ role: 'required', when: '返回成功或请求超时', capabilityId: 'platform-rule-management-get', mapping: { id: 'args.draft.id' }, instruction: '按id读取最新详情；不要把HTTP成功当作字段已更新的唯一证据。' }] })

contracts['platform-rule-management-prepare-create']!.inputs.form = param('Portal规则新建表单对象；ruleCode、ruleName、ruleExpression、ruleType、ruleGroup、enabled、priority、systemType、version必填，ruleDescription可空。', '用户填写的规则表单或页面初始值', { type: 'object', required: true })
contracts['platform-rule-management-create']!.inputs.draft = param('prepareCreate返回的创建draft；不要自行添加id或修改字段类型。', 'platform-rule-management-prepare-create.result.draft', { type: 'object', required: true })
contracts['platform-rule-management-create']!.inputs['draft.ruleCode'] = param('创建draft中的规则编码，用于创建后按完整编码回查。', 'platform-rule-management-prepare-create.result.draft.ruleCode', { type: 'string', required: false })
contracts['platform-rule-management-prepare-update']!.inputs.form = param('Portal规则编辑表单对象；必须包含get/list得到的id和全部可编辑字段。', 'platform-rule-management-get.result 或用户明确修改', { type: 'object', required: true })
contracts['platform-rule-management-update']!.inputs.draft = param('prepareUpdate返回的更新draft；保留id和全部字段。', 'platform-rule-management-prepare-update.result.draft', { type: 'object', required: true })
contracts['platform-rule-management-update']!.inputs['draft.id'] = param('更新draft中的规则ID，用于提交后按ID回查。', 'platform-rule-management-prepare-update.result.draft.id', { type: 'string | number', required: false })

export const PLATFORM_RULE_MANAGEMENT_AI_CONTRACTS = contracts
export const PLATFORM_RULE_MANAGEMENT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PLATFORM_RULE_MANAGEMENT_METHODS).map(([id, method]) => [
    `platformRuleManagement.${method}`,
    {
      ...contracts[id]!,
      boundaries: [...contracts[id]!.boundaries, '直接SDK方法路径为 platformRuleManagement.' + method + '；写方法只接受对应prepare方法生成的draft。'],
    },
  ]),
)
