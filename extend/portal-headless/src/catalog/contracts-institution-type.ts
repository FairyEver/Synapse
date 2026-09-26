import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { INSTITUTION_TYPE_METHODS, institutionTypeCapabilities } from '../capabilities/institution-type.js'

const definitions = new Map(institutionTypeCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const rowFields: AiField[] = [
  field('id', 'string | number', '制度类型 ID；Java Long 可能序列化为字符串，编辑、删除和制度表单关联必须原样保留'),
  field('name', 'string | null', '制度类型名称；表单必填且最多15个字符', { nullable: true, nullMeaning: '详情响应缺少名称或后端返回null' }),
  field('sort', 'number | null', 'APP端排序；列表接口把后端null按Portal服务规则归一为99999，详情null表示未设置', { nullable: true, constraints: ['表单提交时必须是非负整数'] }),
  field('size', 'number | null', '后端响应中的关联制度数量；本页列表和表单不编辑此字段', { nullable: true, nullMeaning: '后端未返回统计值' }),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('list', 'object[]', 'Portal customLoad转换后的制度类型列表'),
    ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` })),
    field('total', 'number', 'Portal按数组长度计算的总数；后端/page本身返回数组，不是分页对象'),
  ],
  empty: 'list=[]且total=0表示当前名称筛选下没有制度类型；权限、会话、网络或响应形状错误会抛出，不降级为成功。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: rowFields,
  empty: '不存在、无权限或响应字段形状不符合Portal详情时抛错；SDK不把缺失详情降级为空对象。',
}

const preparationOutput = (label: string): AiContract['output'] => ({
  shape: '{ draft: object, previous?: object }',
  fields: [
    field('draft', 'object', `${label}已按Portal表单规则校验、尚未写入的完整草稿`),
    field('previous', 'object', '编辑前的表单快照；取消时只丢弃draft，不调用写接口', { optional: true }),
  ],
  empty: '名称、排序、ID或响应字段不符合Portal时在发请求前抛错。',
})

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '后端CommonResult<Boolean>解包后的成功值true')],
  empty: '没有true或请求抛错不能报告保存或删除成功；写操作必须按steps回查。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ f61fdca1513956765ce3b927b8a9e961ef3742d3: app/portal/menus/hr.js、views/dashboard/hr/institution/type.vue、views/dashboard/hr/institution/type/list.vue、views/dashboard/hr/institution/type/[mode]/[id].vue、common/libs/renren/list.js、common/libs/renren/form.js', kind: 'reference', note: '逐页核对菜单路径/权限、platform实例、module-type页面上下文、order/orderField/name/pageNo/pageSize请求、数组到list/total转换、编辑删除入口、trim、15字符和排序控件规则。' },
  { source: 'CodeReview_Mall_Platform_Java @ 7aeaca409d5999d8ba7723f47fd248a0ef56b170: HrPolicyCategoryController、HrPolicyCategorySaveReqVO、HrPolicyCategoryPageRepVO、HrPolicyCategoryRespVO、HrPolicyCategoryServiceImpl、HrPolicyCategoryDO', kind: 'reference', note: '核对数组列表、详情、创建、更新、删除、Long ID、租户DO、名称重复和制度类型被使用时拒绝删除。' },
  { source: 'src/capabilities/institution-type.ts 与 test/institution-type.test.ts', kind: 'implementation', note: '锁定逐字段请求、Portal表单转换、响应形状和坏输入反证；不替代真实环境写入回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作Portal「风险防控 → 制度管理 → 制度类型」列表或表单。',
  boundaries: [
    '页面路径是/dashboard/institution/type/list，权限是/dashboard/institution/type；请求使用platform HTTP实例和module-type=15（风险防控），调用方不要另拼页面上下文。',
    '列表只有name一个可见筛选；Portal的列表模块每次还发送order=""、orderField=""、pageNo和pageSize，后端/page实际返回数组，页面再按数组长度生成list/total，后端不按页切分。',
    'name筛选保持用户输入原文，省略时发送空字符串；表单name必填、失焦trim且最多15字符，sort必填且为a-input-number的非负整数。',
    '新建请求只发送name和sort；编辑请求只发送id、name和sort，不把size、tenantId、creator或updater回传。',
    '名称重复会被Java服务拒绝；仍被公司制度使用的制度类型不能删除。列表、详情和写入受当前会话、租户、页面权限及后端数据范围约束。',
    'SDK不把HTTP成功或Boolean true单独当作业务完成证据；写操作要按steps重新列表或详情回查。',
  ],
  prerequisites: ['使用当前用户会话、租户和页面权限创建SDK；制度类型ID必须来自institution-type-list或institution-type-get，不猜ID。'],
  failures: ['名称/排序/ID、重复名称、被制度使用、权限、租户、网络和响应形状错误会抛出；不把空列表、空详情或true回执包装成已验证业务结果。'],
  evidence,
  gaps: ['已完成Portal/Java逐页静态核对与离线请求断言；尚未在真实测试环境执行制度类型prepare→submit→cancel、删除及写入回查。'],
})

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Institution type contract has no definition: ${id}`)
  contracts[id] = value
}

const idInput = (meaning: string, source: string): Record<string, AiParameter> => ({ id: param(meaning, source, { type: 'string | number', required: true }) })
const formInput = param('Portal制度类型表单；包含类型名称和APP端排序。', '用户明确填写的表单', { type: 'object', required: true, constraints: ['name必填，SDK按Portal失焦语义去除首尾空格且最多15个字符', 'sort必填且为非负整数'] })
const draftInput = (meaning: string, source: string): AiParameter => param(meaning, source, { type: 'object', required: true })

add('institution-type-list', base({
  purpose: '读取当前用户在制度类型页面可见的制度类型列表。',
  effect: 'read',
  inputs: {
    name: param('类型名称筛选；保持用户输入原文，省略时发送空字符串。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
    pageNo: param('Portal列表页码；仅用于复刻页面请求，默认1。后端返回全数组，SDK不自行切片。', '分页状态', { type: 'number', required: false, default: '1', constraints: ['正整数'] }),
    pageSize: param('Portal列表每页数量；仅用于复刻页面请求，默认20。后端返回全数组，SDK不自行切片。', '分页状态', { type: 'number', required: false, default: '20', constraints: ['正整数'] }),
  },
  output: pageOutput,
  consume: ['用list[].id作为get、prepareUpdate和remove的唯一定位；sort用于编辑时的当前表单值，size只读。'],
  steps: [],
  completion: '返回Portal customLoad语义下的制度类型列表和数组长度总数；查询不修改数据。',
  idempotency: null,
}))

add('institution-type-get', base({
  purpose: '读取一条制度类型的最新详情，用于编辑准备和写入回查。',
  effect: 'read',
  inputs: idInput('制度类型ID。', 'institution-type-list.list[].id'),
  output: detailOutput,
  consume: ['详情中的id、name和sort直接用于prepareUpdate；size只读，不提交。'],
  steps: [],
  completion: '得到目标制度类型的最新详情快照。',
  idempotency: null,
}))

add('institution-type-prepare-create', base({
  purpose: '按Portal制度类型新建表单规则校验并准备尚未写入的草稿。',
  effect: 'prepare',
  inputs: { form: formInput },
  output: preparationOutput('制度类型'),
  consume: ['用户取消时只丢弃draft；确认保存时把同一draft传给institution-type-create。'],
  steps: [
    { role: 'required', when: '用户确认保存', capabilityId: 'institution-type-create', mapping: { draft: 'result.draft' }, instruction: '只提交返回的draft；成功后按名称、ID和完整字段回查列表或详情。' },
    { role: 'cancel', when: '用户取消表单', instruction: '丢弃draft，不调用写接口。' },
  ],
  completion: '得到已校验、尚未写入的制度类型草稿。',
  idempotency: null,
}))

add('institution-type-create', base({
  purpose: '保存一个已准备的制度类型新建草稿。',
  effect: 'write',
  inputs: { draft: draftInput('prepareCreate返回的完整制度类型新建草稿。', 'institution-type-prepare-create.draft') },
  output: trueOutput,
  consume: ['SDK按Portal customSubmit只提交name和sort；后端只返回true，不能从true推导新ID。'],
  steps: [{ role: 'required', when: '请求成功或超时后核实结果', capabilityId: 'institution-type-list', instruction: '按draft.name筛选并逐条核对name、sort；超时先回查，不盲目重复创建。' }, { role: 'cancel', when: '用户取消', instruction: '不调用create。' }],
  completion: '列表或详情回查确认新制度类型存在且字段符合draft后报告创建完成。',
  idempotency: '后端无requestId；创建超时先按名称回查，不能盲目重复创建。',
}))

add('institution-type-prepare-update', base({
  purpose: '基于最新制度类型详情和用户修改准备完整编辑草稿。',
  effect: 'prepare',
  inputs: {
    current: param('institution-type-get返回的最新制度类型详情。', 'institution-type-get', { type: 'object', required: true }),
    changes: param('用户明确修改的name或sort；省略字段保持current值。', '用户编辑意图', { type: 'object', required: false, nullable: true }),
  },
  output: preparationOutput('制度类型'),
  consume: ['prepare不会发请求；取消时不调用update。'],
  steps: [
    { role: 'required', when: '用户确认保存', capabilityId: 'institution-type-update', mapping: { draft: 'result.draft' }, instruction: '提交完整draft后按draft.id读取详情回查。' },
    { role: 'cancel', when: '用户取消', instruction: '只丢弃draft。' },
  ],
  completion: '得到尚未写入的制度类型编辑草稿。',
  idempotency: null,
}))

add('institution-type-update', base({
  purpose: '保存已准备的制度类型编辑草稿。',
  effect: 'write',
  inputs: { draft: draftInput('prepareUpdate返回的含id制度类型草稿。', 'institution-type-prepare-update.draft') },
  output: trueOutput,
  consume: ['请求是Portal的PUT /admin-api/system/policy-category/update，只提交id、name和sort；true或超时后必须按draft.id回查。'],
  steps: [{ role: 'required', when: '请求成功或超时后核实结果', capabilityId: 'institution-type-get', mapping: { id: 'args.draft' }, instruction: '读取同一ID详情并逐字段核对name和sort；未确认前不要重复覆盖保存。' }, { role: 'cancel', when: '用户取消', instruction: '不调用update。' }],
  completion: '详情回查确认制度类型编辑生效后报告完成。',
  idempotency: '无requestId；PUT覆盖式更新，超时先回查。',
}))

add('institution-type-remove', base({
  purpose: '删除一个制度类型。',
  effect: 'write',
  inputs: idInput('制度类型ID；仍被公司制度使用时Java服务会拒绝删除。', 'institution-type-list.list[].id'),
  output: trueOutput,
  consume: ['删除成功或超时后重新按名称查询并逐页确认原ID已消失；被制度使用时保留后端错误。'],
  steps: [{ role: 'required', when: '删除请求成功或超时后核实结果', capabilityId: 'institution-type-list', instruction: '使用调用前保留的名称筛选和原ID回查；若仍存在，不自动再次删除。' }, { role: 'cancel', when: '用户取消删除', instruction: '不调用remove。' }],
  completion: '列表回查确认目标ID已消失后报告删除完成。',
  idempotency: '无requestId；超时先回查，不重复删除已消失节点。',
}))

export const INSTITUTION_TYPE_AI_CONTRACTS = contracts
export const INSTITUTION_TYPE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(INSTITUTION_TYPE_METHODS).map(([id, method]) => [`institutionType.${method}`, { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, '直接SDK方法按inputs接收对象参数；prepare只产生草稿，不能被误报为已写入。'] }]),
)
