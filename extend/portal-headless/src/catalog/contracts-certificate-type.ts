import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { CERTIFICATE_TYPE_METHODS, certificateTypeCapabilities } from '../capabilities/certificate-type.js'

const definitions = new Map(certificateTypeCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const rowFields: AiField[] = [
  field('id', 'string | number', '证照类型 ID；Java Long 可能序列化为字符串，编辑和删除必须原样保留'),
  field('name', 'string | null', '证照类型名称；表单必填且最多15字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('remindTime', 'number | null', '提前提醒月数；Portal 表单要求非负整数，0 表示不提前提醒', { nullable: true, nullMeaning: '后端未返回' }),
  field('count', 'number | null', '当前类型下已有证照数量；只读统计', { nullable: true, nullMeaning: '后端未返回' }),
  field('tipTemplateId', 'string | number | null', '绑定的提示词模板 ID；可为空', { nullable: true, nullMeaning: '未绑定模板' }),
]
const listOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: rowFields.map(item => ({ ...item, path: `[].${item.path}` })),
  empty: '[] 表示当前租户没有符合名称筛选的证照类型；权限、会话、网络或响应形状错误会抛出，不降级为空数组。',
}
const detailOutput: AiContract['output'] = { shape: 'object', fields: rowFields, empty: '不存在、无权限或响应字段形状不符合 Portal 详情会抛错；SDK 不把缺失详情降级为空对象。' }
const templatesOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('[].id', 'string | number', '提示词模板 ID'), field('[].name', 'string', '下拉框展示的模板名称')],
  empty: '[] 表示当前 useType=license 没有可选模板；不能自行猜测模板 ID。',
}
const trueOutput: AiContract['output'] = { shape: 'true', fields: [field('$', 'true', '后端 CommonResult<Boolean> 解包后的成功值 true')], empty: '没有 true 或请求抛错不能报告保存或删除成功；写操作必须按 steps 回查。' }
const preparationOutput = (label: string): AiContract['output'] => ({ shape: '{ draft: object, previous?: object }', fields: [field('draft', 'object', `${label}已按 Portal 表单规则校验、尚未写入的完整草稿`), field('previous', 'object', '编辑前的表单快照；取消时只丢弃 draft，不调用写接口', { optional: true })], empty: '名称、提醒月数、ID 或可选模板字段不符合 Portal 时在发请求前抛错。' })

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ 8b9a5554d4: app/portal/menus/hr.js、views/dashboard/hr/certificate/type/list.vue、views/dashboard/hr/certificate/type/[mode]/[id].vue', kind: 'reference', note: '逐页核对菜单路径/权限、名称筛选、列表 CRUD、表单字段、trim、非负整数、15字符限制和提示词模板 useType=license 请求。' },
  { source: 'CodeReview_Mall_Platform_Java @ d83e4086fd5: HrLicenseCategoryController、HrLicenseCategorySaveReqVO、HrLicenseCategoryPageRepVO、HrLicenseCategoryRespVO、HrLicenseCategoryServiceImpl、HrLicenseCategoryDO', kind: 'reference', note: '核对证照类型列表、详情、创建、更新、删除、租户 DO、名称重复和仍被证照使用时拒绝删除；Controller 返回列表或 Boolean。' },
  { source: 'src/capabilities/certificate-type.ts 与 test/certificate-type.test.ts', kind: 'implementation', note: '锁定请求参数、表单转换、响应形状和坏输入反证；不替代真实环境写入回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「风险防控 → 证照类型」列表或表单。',
  boundaries: [
    '页面路径是/dashboard/certificate/type/list，权限是/dashboard/certificate/type；请求使用 platform HTTP 实例和 module-type=15（风险防控），调用方不要另拼页面上下文。',
    '列表只有 name 一个可见筛选，初始值是空字符串；列表接口返回数组，不是 {list,total} 分页对象。',
    '表单 name 必填，Portal blur 时去除首尾空格且最多15字符；remindTime 必填且为大于等于0的整数；tipTemplateId 可以清空并按 null 提交。',
    'count 是后端按当前租户证照使用情况补充的只读数量；删除仍被证照使用的类型会被 Java 服务拒绝，SDK 不绕过这个权限和业务规则。',
    '提示词模板只请求 useType=license；模板候选的 id/name 来自 Portal 下拉数据，不能用名称猜 ID。',
    '列表、详情、写入受当前会话、租户、页面权限及后端数据范围约束；SDK 不把 HTTP 成功、true 或空数组单独当作业务完成证据。',
  ],
  prerequisites: ['使用当前用户会话、租户和页面权限创建 SDK；提示词模板 ID 必须来自 certificate-type-tip-templates 或用户确认的候选。'],
  failures: ['表单规则、ID、名称重复、类型仍被证照使用、权限、租户、网络或响应形状错误原样抛出；不把空数组、空详情或 true 当作最终业务证据。'],
  evidence,
  gaps: ['已完成 Portal/Java 逐页静态核对与离线请求断言；尚未在真实测试环境执行证照类型 prepare→submit→cancel、删除及写入回查。'],
})

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Certificate type contract has no definition: ${id}`)
  contracts[id] = value
}

const formInput = param('Portal 证照类型表单；包含类型名称、提前提醒月数和可选提示词模板。', '用户明确填写的表单与已核实模板候选', { type: 'object', required: true, constraints: ['name必填且最多15字符，SDK按Portal blur语义去除首尾空格', 'remindTime必填且为非负整数', 'tipTemplateId可为null'] })
const draftInput = (meaning: string): AiParameter => param(meaning, 'certificate-type-prepare-create 或 certificate-type-prepare-update.draft', { type: 'object', required: true })

add('certificate-type-list', base({ purpose: '读取当前用户在证照类型页面可见的类型列表。', effect: 'read', inputs: { name: param('类型名称筛选；省略时发送空字符串。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }) }, output: listOutput, consume: ['用 [].id 作为 get、prepareUpdate 和 remove 的唯一定位；count 只展示当前类型的证照数量。'], steps: [], completion: '返回当前筛选的证照类型数组；查询不修改数据。', idempotency: null }))
add('certificate-type-get', base({ purpose: '读取一条证照类型的最新详情，用于编辑准备和写入回查。', effect: 'read', inputs: { id: param('证照类型 ID。', 'certificate-type-list[].id', { type: 'string | number', required: true }) }, output: detailOutput, consume: ['详情中的 id、name、remindTime、tipTemplateId 直接用于 prepareUpdate；count 是只读统计，不提交。'], steps: [], completion: '得到目标证照类型的最新详情快照。', idempotency: null }))
add('certificate-type-tip-templates', base({ purpose: '读取证照类型表单下拉框使用的 license 提示词模板候选。', effect: 'read', inputs: {}, output: templatesOutput, consume: ['把返回的 id 作为 tipTemplateId；[] 时提交 null 或让用户不绑定，不自行编造 ID。'], steps: [], completion: '返回当前租户可选的证照提示词模板候选。', idempotency: null }))
add('certificate-type-prepare-create', base({ purpose: '按 Portal 证照类型新建表单规则校验并准备尚未写入的草稿。', effect: 'prepare', inputs: { form: formInput }, output: preparationOutput('证照类型'), consume: ['用户取消时只丢弃 draft；确认保存时把同一 draft 传给 certificate-type-create。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'certificate-type-create', mapping: { draft: 'result.draft' }, instruction: '只提交返回的 draft；成功后按名称和完整字段回查列表或详情。' }, { role: 'cancel', when: '用户取消表单', instruction: '丢弃 draft，不调用写接口。' }], completion: '得到已校验、尚未写入的证照类型草稿。', idempotency: null }))
add('certificate-type-create', base({ purpose: '保存一个已准备的证照类型新建草稿。', effect: 'write', inputs: { draft: draftInput('certificate-type-prepare-create 返回的完整新建草稿。') }, output: trueOutput, consume: ['SDK 按 Portal customSubmit 提交 name、remindTime 和 tipTemplateId；后端只返回 true，必须按名称和完整字段回查列表或 get 证实。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'certificate-type-list', instruction: '按 draft.name 筛选并逐字段核对 name、remindTime、tipTemplateId；超时先回查，不要盲目重复创建。' }], completion: '列表或详情回查确认新类型存在且字段符合草稿后报告创建完成。', idempotency: '后端没有 requestId；名称重复时后端拒绝，超时先按名称与字段回查，不能盲目重复创建。' }))
add('certificate-type-prepare-update', base({ purpose: '基于最新证照类型详情和用户明确修改准备完整编辑草稿。', effect: 'prepare', inputs: { current: param('certificate-type-get 返回的最新详情或列表行。', 'certificate-type-get 或 certificate-type-list', { type: 'object', required: true }), changes: param('用户明确修改的 name、remindTime 或 tipTemplateId；未修改字段保留 current。', '用户编辑意图', { type: 'object', required: false, nullable: true }) }, output: preparationOutput('证照类型'), consume: ['prepare 会丢弃 count 等只读字段，仅保留 Portal 编辑表单字段；取消不调用 update。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'certificate-type-update', mapping: { draft: 'result.draft' }, instruction: '提交完整 draft；完成后用 certificate-type-get 回查。' }, { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃 draft，不调用 update。' }], completion: '得到尚未写入的完整证照类型编辑草稿。', idempotency: null }))
add('certificate-type-update', base({ purpose: '保存已准备的证照类型编辑草稿。', effect: 'write', inputs: { draft: draftInput('certificate-type-prepare-update 返回的含 id 完整草稿。') }, output: trueOutput, consume: ['提交是 Portal 的 PUT /admin-api/system/license-category/update；成功或超时后按 draft.id 读取详情，逐字段核对保存结果。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'certificate-type-get', mapping: { id: 'args.draft' }, instruction: '从 draft.id 回查同一证照类型；未确认终态前不要重复 PUT。' }], completion: '详情回查确认编辑后的字段已生效后报告更新完成。', idempotency: '无 requestId；PUT 是绝对值覆盖，超时先回查，避免覆盖他人后续修改。' }))
add('certificate-type-remove', base({ purpose: '删除一条证照类型记录。', effect: 'write', inputs: { id: param('证照类型 ID；必须来自当前列表或详情。', 'certificate-type-list[].id', { type: 'string | number', required: true }) }, output: trueOutput, consume: ['Java 服务会检查类型下是否还有证照；删除成功或超时后重新查询列表，确认目标 ID 不再出现。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'certificate-type-list', instruction: '按原筛选刷新并确认目标 ID 已消失；若类型仍被使用，保留后端业务错误。' }, { role: 'cancel', when: '用户取消删除', instruction: '不调用 remove。' }], completion: '列表回查确认目标已消失后报告删除完成。', idempotency: '无 requestId；超时先回查列表，已删除终态不要重复发起。' }))

export const CERTIFICATE_TYPE_AI_CONTRACTS = contracts
export const CERTIFICATE_TYPE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(CERTIFICATE_TYPE_METHODS).map(([id, method]) => [`certificateType.${method}`, { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, '直接 SDK 方法按 inputs 接收对象参数；prepare 只产生草稿，不能被误报为已写入。'] }]))
