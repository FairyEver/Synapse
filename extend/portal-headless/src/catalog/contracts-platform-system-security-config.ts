import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PLATFORM_SECURITY_CONFIG_GROUPS,
  PLATFORM_SECURITY_CONFIG_VALUE_TYPES,
  platformSystemSecurityConfigCapabilities,
} from '../capabilities/platform-system-security-config.js'

const definitions = new Map(platformSystemSecurityConfigCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const rowFields: AiField[] = [
  field('id', 'string | number', '安全配置主键；Java Long 可能以字符串返回，后续值保存、元数据编辑和删除都使用该 ID', { constraints: ['正整数；保留长整数原始字符串，不要转成 JavaScript 不安全整数'] }),
  field('configKey', 'string', '配置键；创建时由后端校验为小写点分格式，编辑时原样提交'),
  field('configName', 'string', '页面显示名称'),
  field('configGroup', 'string', '配置分组；只应为五个固定分组之一'),
  field('valueType', 'string', '值类型：BOOLEAN、INTEGER、STRING、SINGLE_CHOICE 或 MULTI_CHOICE'),
  field('configValue', 'string', '当前配置值；统一以字符串保存，MULTI_CHOICE 时是 JSON 数组字符串'),
  field('defaultValue', 'string | null', '默认配置值；页面展示原值，null 表示后端未设置', { nullable: true, nullMeaning: '后端未设置默认值' }),
  field('optionsJson', 'string | null', '单选/多选的选项 JSON 数组字符串', { nullable: true, nullMeaning: '该类型没有选项或后端未设置' }),
  field('description', 'string | null', '配置说明', { nullable: true, nullMeaning: '未填写说明' }),
  field('isBuiltin', 'boolean', '是否内置；true 时 Portal 不显示删除按钮，后端也拒绝删除'),
  field('sort', 'integer | null', '同分组排序值；Portal 按 sort、再按数值 ID 排序', { nullable: true, nullMeaning: '后端未设置排序' }),
  field('remark', 'string | null', '备注', { nullable: true, nullMeaning: '未填写备注' }),
  field('updateTime', 'string | null', '更新时间原值', { nullable: true, nullMeaning: '后端未返回更新时间' }),
]

const listOutput: AiContract['output'] = {
  shape: `{ ${PLATFORM_SECURITY_CONFIG_GROUPS.map(group => `${group}: object[]`).join(', ')} }`,
  fields: PLATFORM_SECURITY_CONFIG_GROUPS.flatMap(group => [
    field(group, 'object[]', `${group} 分组的安全配置列表；Portal 只展示这五个固定分组`),
    ...rowFields.map(item => ({ ...item, path: `${group}[].${item.path}` })),
  ]),
  empty: '每个分组都始终返回数组；某分组为空表示该分组当前没有配置项，不把空分组解释成权限失败。未知服务端分组按 Portal 行为不暴露给调用方。',
}

const valuesPlanOutput: AiContract['output'] = {
  shape: '{ payload: object[] }',
  fields: [
    field('payload', 'object[]', '当前分组全部配置值的最终请求数组；不是只包含变更行的差量'),
    field('payload[].id', 'string | number', '配置主键，来自同一 list 结果'),
    field('payload[].configValue', 'string', '配置值；空字符串也要保留，不能改成 null 或省略'),
  ],
  empty: 'payload=[] 只表示调用方明确准备保存空数组；不要把它当作未读取当前分组。',
}

const objectPlanOutput = (fields: AiField[]): AiContract['output'] => ({
  shape: '{ payload: object }',
  fields: [field('payload', 'object', 'Portal 最终提交的字段投影'), ...fields.map(item => ({ ...item, path: `payload.${item.path}` }))],
  empty: '校验失败会抛错而不产生 payload；payload 中的空字符串、null 和省略字段按页面表单值解释，不自行补业务含义。',
})

const booleanOutput: AiContract['output'] = {
  shape: 'boolean',
  fields: [field('$', 'boolean', '后端 CommonResult<Boolean> 的业务成功值；true 只代表请求被服务端接受，不含完整状态快照')],
  empty: '没有返回值或请求抛错都不能报告写入成功；成功后必须 list 回查。',
}

const idOutput: AiContract['output'] = {
  shape: 'string | number | null',
  fields: [field('$', 'string | number | null', '后端新建配置主键；保留原始 ID 形态，null 表示响应没有业务 ID')],
  empty: '返回 null 或请求结果不确定时，先 list 按 configKey/configName 回查，不要盲目重复创建。',
}

const removePlanOutput: AiContract['output'] = {
  shape: '{ id: string | number, isBuiltin: false }',
  fields: [
    field('id', 'string | number', '待删除的自定义配置主键'),
    field('isBuiltin', 'false', '页面删除规则的证明字段；必须明确为 false'),
  ],
  empty: 'isBuiltin 为 true、缺省或记录不是列表返回行时，准备阶段抛错且不发请求。',
}

const groupsInput = param('当前分组从 list 返回的全部配置值；每项只提交 id 和 configValue。', '同一 SDK 实例 platform-system-security-config-list 的结果，选中分组后保留完整数组', { type: 'object[]', required: true, constraints: ['不能只传修改行；Portal 保存会提交当前分组全部行'] })
const createFormInput = param('新增自定义配置表单；应按当前 Portal 表单状态提供字段，缺省值按页面新建表单规则补齐。', '用户输入或 Portal 新建抽屉的当前表单', { type: 'object', required: true, constraints: ['Portal 只以 truthy 判断 configKey/configName；Java 还要求二者 @NotBlank', 'configGroup 是五个固定分组之一；valueType 是五个固定类型之一', 'Java create 的 configKey 正则为 ^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)+$', 'BOOLEAN 值只能为 true/false；INTEGER 必须是整数；选择类型的当前值必须来自 optionsJson'] })
const updateFormInput = param('编辑配置元数据表单；不包含 configValue，值修改必须走整组保存。', '同一 SDK 实例 list 返回的行，经用户确认后的表单', { type: 'object', required: true, constraints: ['必须带 id、configKey、configName、configGroup'] })
const recordInput = param('待删除的当前列表行；必须保留 isBuiltin。', '同一 SDK 实例 list 返回的某一行', { type: 'object', required: true, constraints: ['仅 isBuiltin=false 的自定义配置可进入删除；内置项必须停止'] })

function typeOf (kind: string): string {
  if (kind === 'number') return 'number'
  if (kind === 'boolean') return 'boolean'
  return 'string'
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (definition === undefined) throw new Error(`Platform security config contract has no capability: ${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: typeOf(parameter.kind),
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: 'Portal 安全配置页面输入或同一页面读取结果；不要凭名称猜 ID 或分组。',
  }]))
}

const commonEvidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/mall.v2.js 与 app/portal/views/dashboard/platform/system/security-config.vue/list.vue/define.js', kind: 'reference', note: '证明页面路径、v2 权限、platform 实例、五个固定分组、本地编辑/重置、整组值保存、创建/元数据编辑/删除字段投影和内置删除按钮条件。' },
  { source: 'PlatformConfigController、PlatformConfig*ReqVO/RespVO、PlatformConfigServiceImpl @ CodeReview_Mall_Platform_Java/test/test', kind: 'reference', note: '证明 adminmanage API 端点、DTO 必填规则、配置值按类型校验、重复 key、内置删除限制和返回类型；未把页面未调用的后端查询接口暴露为能力。' },
  { source: 'src/capabilities/platform-system-security-config.ts 与 test/platform-system-security-config.test.ts', kind: 'implementation', note: '证明 SDK 返回归一化、长 ID、请求体投影、准备阶段校验和离线反证；不替代真实测试环境冒烟。' },
  { source: 'docs/pages/安全配置.md', kind: 'reference', note: '记录逐页对齐结论、权限边界、表单规则以及尚未实测的范围。' },
]

const liveGaps = [
  '本轮已核对固定 Portal/Java 源码、SDK 实现和离线请求断言；尚未在真实测试环境执行本页浏览器读操作。',
  '本页没有 Portal 可达的撤销接口；写入已提供 prepare 与对应 submit 能力，但无法伪造 cancel。真实环境写入必须先保存原值，成功或超时后 list 回查；删除不可恢复。',
]

const metadataFields: AiField[] = [
  field('id', 'string | number', '已有配置主键'),
  field('configKey', 'string', '配置键；更新接口要求非空'),
  field('configName', 'string', '配置显示名称；更新接口要求非空'),
  field('configGroup', 'string', '五个固定分组之一'),
  field('description', 'string | null', '配置说明', { nullable: true }),
  field('sort', 'integer | null', '排序值；缺省按页面新建表单的99，显式null保留为null', { nullable: true }),
  field('remark', 'string | null', '备注', { nullable: true }),
]

const createFields: AiField[] = [
  field('configKey', 'string', '配置键；页面只做非空校验，后端另校验小写点分格式', { constraints: ['Java create 正则：^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)+$'] }),
  field('configName', 'string', '配置名称'),
  field('configGroup', 'string', '配置分组；Portal 根据当前 activeGroup 填入，SDK 要求调用方显式传入，不能猜测当前分组'),
  field('valueType', 'string', '值类型；缺省 BOOLEAN，切换到 INTEGER/STRING/SINGLE_CHOICE/MULTI_CHOICE 时按 Portal 联动默认值'),
  field('configValue', 'string | null', '当前值；按 valueType 默认 false/0/空字符串/[] 字符串', { nullable: true }),
  field('defaultValue', 'string | null', '默认值；按 valueType 与 Portal 联动默认值', { nullable: true }),
  field('optionsJson', 'string | null', '选项 JSON；选择类型缺省 []，其他类型缺省 null', { nullable: true }),
  field('description', 'string | null', '说明；缺省空字符串', { nullable: true }),
  field('sort', 'integer | null', '排序；缺省99，显式null保留', { nullable: true }),
  field('remark', 'string | null', '备注；缺省空字符串', { nullable: true }),
]

const contracts: Record<string, AiContract> = {}

function add (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void {
  const definition = definitions.get(id)
  if (definition === undefined) throw new Error(`Platform security config contract has no capability: ${id}`)
  contracts[id] = {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只覆盖 Portal「平台设置 → 系统设置 → 安全配置」页面：/dashboard/platform/system/security-config/list；权限标识为 /dashboard/platform-v2/system/security-config。',
      '请求使用 platform HTTP 实例和 /adminmanage-api/adminmanage/platform-config 前缀；页面不发送 module-type，不能把 platform 配置误套成租户模块范围。',
      '列表固定归一为 identity_auth、session_mgmt、intrusion_prevention、audit、cryptography 五个数组；页面未调用的 list-by-group/get/get-by-key/list-by-keys 后端接口不属于本页能力。',
      '页面对当前分组先本地编辑和重置；点击保存时将当前分组全部 { id, configValue } 提交，不能只提交 dirty 行。创建和元数据编辑是另外两个请求，更新元数据不改变 configValue。',
      '页面 permission 是 Portal 路由/可见性规则；Java Controller 本身没有逐操作 @PreAuthorize，不能把它描述成 SDK 已在本地完成服务端权限裁决。后端配置表是平台级系统配置，不凭空增加 tenant_id 筛选。',
    ],
    effect: definition.write ? 'write' : 'read',
    prerequisites: ['使用会话 token 和租户创建 SDK；写入前从同一 SDK 实例读取当前行/当前分组，保留原值用于回查或人工恢复。'],
    output,
    consume,
    steps: [],
    completion: '返回值符合本能力结构；任何写入都必须重新 list，按 ID、configKey、configName、configValue 和 isBuiltin 核对终态。',
    failures: ['参数、ID、页面固定选项、后端配置值类型、重复 configKey、内置删除、权限、会话、网络或服务端业务错误均应抛出；不能把错误降级为空分组或成功。'],
    idempotency: definition.write ? '没有 requestId 幂等保证；写请求超时先 list 核实，不能盲目重复创建、整组保存或删除。' : null,
    evidence: commonEvidence,
    gaps: [...liveGaps],
    ...extra,
    inputs: { ...inputsOf(id), ...extra.inputs },
  }
}

add('platform-system-security-config-list', '读取平台安全配置的五个固定分组。', listOutput, ['按 group[].id、configKey、valueType 和 configValue 展示/消费；值编辑只能针对当前分组的完整数组。'])
add('platform-system-security-config-prepare-update-values', '按 Portal 整组保存规则准备安全配置值请求体，不发请求。', valuesPlanOutput, ['把 result.payload 原样映射为 updateValues({ configs: result.payload })；prepare 成功只表示本地结构校验通过。', '用户取消时丢弃 payload，不调用写能力。'], { effect: 'prepare', inputs: { configs: groupsInput }, steps: [{ role: 'required', when: '用户确认整组保存', capabilityId: 'platform-system-security-config-update-values', mapping: { configs: 'result.payload' }, instruction: '只把同一个 prepare 结果的 payload 作为 configs 提交；不要改成 dirty 行数组。' }, { role: 'cancel', when: '用户取消保存', instruction: '丢弃 payload，不发请求。' }] })
add('platform-system-security-config-update-values', '保存当前分组的全部安全配置值。', booleanOutput, ['成功或超时后调用 list，按当前分组每个 ID 回查 configValue；不能只看 true。'], { inputs: { configs: groupsInput }, steps: [{ role: 'required', when: '保存成功或响应不确定时', capabilityId: 'platform-system-security-config-list', instruction: '重新读取五个分组，找到原分组的全部 ID，逐项核对最终 configValue。' }] })
add('platform-system-security-config-prepare-create', '按 Portal 新增抽屉规则准备自定义安全配置请求体，不发请求。', objectPlanOutput(createFields), ['把 result.payload 原样映射为 create({ form: result.payload })；后端还会校验 configKey 格式、唯一性和值类型。', '用户取消时丢弃 payload，不调用写能力。'], { effect: 'prepare', inputs: { form: createFormInput }, steps: [{ role: 'required', when: '用户确认新增', capabilityId: 'platform-system-security-config-create', mapping: { form: 'result.payload' }, instruction: '只提交同一个 prepare 结果的 payload；成功后再 list 回查。' }, { role: 'cancel', when: '用户取消新增抽屉', instruction: '丢弃 payload，不发请求。' }] })
add('platform-system-security-config-create', '新增一条自定义安全配置。', idOutput, ['保留返回 ID；成功或超时后调用 list，按 configKey/configName 查找并逐字段核对。'], { inputs: { form: createFormInput }, steps: [{ role: 'required', when: '新建成功或响应不确定时', capabilityId: 'platform-system-security-config-list', instruction: '重新读取列表，按完整 configKey、configName、configGroup 和 valueType 回查唯一记录；若有多个匹配，报告结果不确定。' }] })
add('platform-system-security-config-prepare-update', '按 Portal 编辑抽屉规则准备安全配置元数据请求体，不发请求。', objectPlanOutput(metadataFields), ['把 result.payload 原样映射为 update({ form: result.payload })；不要把 configValue 混入元数据请求。', '用户取消时丢弃 payload，不调用写能力。'], { effect: 'prepare', inputs: { form: updateFormInput }, steps: [{ role: 'required', when: '用户确认编辑元数据', capabilityId: 'platform-system-security-config-update', mapping: { form: 'result.payload' }, instruction: '只提交同一个 prepare 结果的 payload；成功后再 list 回查。' }, { role: 'cancel', when: '用户取消编辑抽屉', instruction: '丢弃 payload，不发请求。' }] })
add('platform-system-security-config-update', '编辑已有安全配置的名称、分组、说明、排序和备注等元数据。', booleanOutput, ['成功或超时后调用 list，按 id 逐字段核对元数据和原 configValue。'], { inputs: { form: updateFormInput }, steps: [{ role: 'required', when: '元数据更新成功或响应不确定时', capabilityId: 'platform-system-security-config-list', instruction: '重新读取同一 id，核对 configKey、configName、configGroup、description、sort、remark；确认 configValue 未被此能力改写。' }] })
add('platform-system-security-config-prepare-remove', '按 Portal 内置标志准备删除自定义安全配置，不发请求。', removePlanOutput, ['把 result.$ 原样映射为 remove({ record: result.$ })；只有当前行 isBuiltin=false 才能把计划交给 remove，内置行必须终止。', '用户取消时丢弃删除计划，不调用写能力。'], { effect: 'prepare', inputs: { record: recordInput }, steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'platform-system-security-config-remove', mapping: { record: 'result.$' }, instruction: '只提交同一个 prepare 结果；删除成功后跨五个分组回查目标 ID 已消失。' }, { role: 'cancel', when: '用户取消删除确认', instruction: '丢弃删除计划；删除没有服务端撤销接口。' }] })
add('platform-system-security-config-remove', '删除一条自定义安全配置；不可恢复。', booleanOutput, ['成功或超时后调用 list，跨五个分组核对目标 ID 不再出现；不要把删除解释成可撤销更新。'], { inputs: { record: recordInput }, idempotency: '删除没有 requestId 或恢复接口；超时先 list 核实目标 ID 是否仍存在，不能盲目重复删除。', steps: [{ role: 'required', when: '删除成功或响应不确定时', capabilityId: 'platform-system-security-config-list', instruction: '重新读取五个固定分组，确认目标 id 已不存在；内置配置仍存在是后端保护，不是删除成功。' }] })

for (const id of ['platform-system-security-config-prepare-update-values', 'platform-system-security-config-update-values']) {
  contracts[id]!.inputs['configs[].id'] = param('当前分组某条配置的主键；来自 list 同一分组。', 'platform-system-security-config-list 结果中的 group[].id', { type: 'string | number', required: true })
  contracts[id]!.inputs['configs[].configValue'] = param('该条配置的新当前值；统一字符串，空字符串必须保留。', 'Portal 当前分组本地编辑值', { type: 'string', required: true })
}
for (const id of ['platform-system-security-config-prepare-create', 'platform-system-security-config-create']) {
  for (const item of createFields) {
    const input: Partial<AiParameter> = {
      type: item.type,
      required: !item.nullable && !['description', 'sort', 'remark', 'optionsJson', 'configValue', 'defaultValue'].includes(item.path),
    }
    if (item.nullable !== undefined) input.nullable = item.nullable
    if (item.constraints !== undefined) input.constraints = item.constraints
    contracts[id]!.inputs[`form.${item.path}`] = param(item.meaning, 'Portal 新增抽屉表单或 prepareCreate 返回的 payload', input)
  }
}
for (const id of ['platform-system-security-config-prepare-update', 'platform-system-security-config-update']) {
  for (const item of metadataFields) {
    const input: Partial<AiParameter> = { type: item.type, required: !item.nullable }
    if (item.nullable !== undefined) input.nullable = item.nullable
    if (item.constraints !== undefined) input.constraints = item.constraints
    contracts[id]!.inputs[`form.${item.path}`] = param(item.meaning, 'Portal 编辑抽屉表单或 prepareUpdate 返回的 payload', input)
  }
}
for (const id of ['platform-system-security-config-prepare-remove', 'platform-system-security-config-remove']) {
  contracts[id]!.inputs['record.id'] = param('待删除的自定义配置主键。', '同一 list 结果中的行 id', { type: 'string | number', required: true })
  contracts[id]!.inputs['record.isBuiltin'] = param('内置标志；必须严格为 false。', '同一 list 结果中的行 isBuiltin', { type: 'boolean', required: true, constraints: ['true、缺省或不明确时停止删除'] })
}

export const PLATFORM_SYSTEM_SECURITY_CONFIG_AI_CONTRACTS = contracts
