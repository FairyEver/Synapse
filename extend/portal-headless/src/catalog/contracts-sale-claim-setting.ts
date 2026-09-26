import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALE_CLAIM_SETTING_METHODS } from '../capabilities/sale-claim-setting.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const pagePath = '/dashboard/sale/setting/claim-setting/list'
const pagePermission = '/dashboard/sale/setting/claim-setting'
const createPermission = 'setting:claim-setting:create'
const editPermission = 'setting:claim-setting:edit'
const reasonPermission = 'setting:claim-setting:reason-maintain'
const deletePermission = 'setting:claim-setting:delete'

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '理赔配置主键；编辑、删除、详情和原因维护入口都使用当前列表行ID。'),
  field('list[].claimType', 'integer | null', '理赔类型字典claim_type的value；使用base-dict-get翻译label。', { nullable: true }),
  field('list[].categoryId', 'string | null', '逗号分隔的理赔品类ID字符串；列表原值，不能把categoryName提交为ID。', { nullable: true }),
  field('list[].categoryName', 'string | null', '后端按品类ID补出的展示名称；只读，可能为空。', { nullable: true }),
  field('list[].startDays', 'integer | null', '发货后允许开始理赔的天数；单位天，null/0表示后端业务上的不限起点。', { nullable: true, unit: '天' }),
  field('list[].endDays', 'integer | null', '发货后停止理赔的天数；单位天，null/0表示后端业务上的不限终点。', { nullable: true, unit: '天' }),
]

const detailFields: AiField[] = [
  field('id', 'string | number', '理赔配置主键；编辑和删除必须保留。'),
  field('claimType', 'integer', '理赔类型字典claim_type的数值；详情表单必填。'),
  field('categoryId', '(string | number)[]', 'Portal customLoad把后端逗号字符串转换成品类ID数组；提交时重新join为逗号字符串。'),
  field('categoryName', 'string | null', '后端生成的品类名称展示快照；不用于提交。', { nullable: true }),
  field('startDays', 'integer | null', '发货后开始理赔的天数；单位天。', { nullable: true, unit: '天' }),
  field('endDays', 'integer | null', '发货后结束理赔的天数；单位天。', { nullable: true, unit: '天' }),
]

const categoryFields: AiField[] = [
  field('[]', 'object', '按理赔类型过滤后的品类树根节点。'),
  field('[].catId', 'integer', '品类节点ID；提交到form.categoryId数组。'),
  field('[].parentId', 'integer | null', '父品类ID；只用于树结构。', { nullable: true }),
  field('[].catName', 'string | null', '品类展示名称；不能代替catId。', { nullable: true }),
  field('[].level', 'integer | null', '品类层级原值。', { nullable: true }),
  field('[].label', 'string | null', '后端树标签字段；页面field-names实际使用catName。', { nullable: true }),
  field('[].value', 'integer | null', '后端树值字段；页面field-names实际使用catId。', { nullable: true }),
  field('[].key', 'integer', 'Portal mapTree补出的树节点key，等于catId。'),
  field('[].children', 'object[]', '子品类节点，结构同当前节点。'),
]

const reasonFields: AiField[] = [
  field('[]', 'object', '当前理赔类型的原因列表；页面没有单条原因编辑入口。'),
  field('[].id', 'string | number | null', '原因记录ID；覆盖式保存会原样带回，但后端按理赔类型删除后重建。', { nullable: true }),
  field('[].content', 'string', '理赔原因文本；页面要求非空、最多50字符。'),
]

const formFields: AiField[] = [
  field('form', 'object', 'Portal理赔配置编辑页表单。'),
  field('form.id', 'string | number | null', '编辑时当前配置ID；新建时为空且create请求不发送。', { optional: true, nullable: true }),
  field('form.claimType', 'integer', 'claim_type字典value；必填，先用base-dict-get取得当前候选。'),
  field('form.categoryId', '(string | number)[]', '品类树选择的ID数组；可为空，提交时join成categoryId字符串。'),
  field('form.startDays', 'integer | null', '发货后开始理赔天数；可空，范围0~999。', { nullable: true, unit: '天' }),
  field('form.endDays', 'integer | null', '发货后结束理赔天数；可空，范围0~999；有起始天数时必须更大。', { nullable: true, unit: '天' }),
]

const draftFields: AiField[] = [
  field('draft', 'object', 'create/update实际发送的理赔配置请求体。'),
  field('draft.claimType', 'integer', '理赔类型字典value。'),
  field('draft.categoryId', 'string', 'categoryId数组元素转字符串后按逗号join；空数组发送空字符串。'),
  field('draft.startDays', 'integer | null', '开始理赔天数；单位天。', { nullable: true, unit: '天' }),
  field('draft.endDays', 'integer | null', '结束理赔天数；单位天。', { nullable: true, unit: '天' }),
]

const updateDraftFields = [...draftFields, field('draft.id', 'string | number', '当前已有理赔配置ID；PUT必须携带。')]
const reasonDraftFields: AiField[] = [
  field('draft', 'object', 'reason/save的覆盖式请求体。'),
  field('draft.claimConfigId', 'string | number', '当前理赔配置ID；用于确认原因归属。'),
  field('draft.claimType', 'integer', '理赔类型字典value；后端按此类型先删除旧原因。'),
  field('draft.reasons', 'object[]', '1~20条原因；空数组会被后端拒绝，不是清空语义。'),
  field('draft.reasons[].id', 'string | number | null', '现有原因ID或新原因null；后端覆盖保存时不按ID更新。', { nullable: true }),
  field('draft.reasons[].content', 'string', '原因内容；非空且最多50字符。'),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('$', 'object', '理赔配置分页结果。'), field('list', 'object[]', '当前页配置，不是全量结果。'), field('total', 'number', '符合当前分页查询的总数，用于翻页。'), ...rowFields],
  empty: 'list=[]表示当前页无记录；total=0才表示没有配置，权限或网络错误会抛错。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: detailFields,
  empty: '详情不存在或categoryId格式不合法时抛错，不伪造空表单。',
}

const categoryOutput: AiContract['output'] = { shape: 'object[]', fields: categoryFields, empty: 'claimType缺失时Portal不发请求并返回[]；有理赔类型但没有候选时也是[]。' }
const reasonOutput: AiContract['output'] = { shape: 'object[]', fields: reasonFields, empty: '没有原因时返回[]；原因接口失败会抛错，不伪造一条空原因。' }
const trueOutput: AiContract['output'] = { shape: 'boolean', fields: [field('$', 'boolean', 'Java接口业务成功回执；SDK只接受true，不包含写入后的详情。', { values: { true: '后端接受请求' } })], empty: '返回false、缺失或其它值时抛错；true仍需要独立回查。' }
const prepareCreateOutput: AiContract['output'] = { shape: '{ draft: object }', fields: draftFields, empty: '表单校验失败时准备阶段抛错且不发送请求；成功只代表本地草稿已整理。' }
const prepareUpdateOutput: AiContract['output'] = { shape: '{ draft: object }', fields: updateDraftFields, empty: '缺少当前ID或表单校验失败时准备阶段抛错且不发送请求。' }
const removeOutput: AiContract['output'] = { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待用户确认删除的当前列表配置ID。')], empty: 'ID非法时准备阶段抛错且不发送DELETE。' }
const prepareReasonsOutput: AiContract['output'] = { shape: '{ draft: object }', fields: reasonDraftFields, empty: '原因少于1条、多于20条、空白、超长或重复时准备阶段抛错。' }

const formInput = param('Portal理赔配置编辑页表单。', '用户输入、sale-claim-setting-get.categoryId数组和sale-claim-setting-category-list节点；claimType来自base-dict-get', {
  type: 'object',
  required: true,
  constraints: [
    'claimType必填；categoryId可为空数组；startDays/endDays可为空且范围为0~999。',
    '页面endDays输入框最小值为(startDays ?? 0)+1；两者同时存在时endDays必须大于startDays。',
    'create不发送id；update必须保留当前列表/详情id；categoryName等展示字段不进入请求体。',
  ],
})
const createDraftInput = param('prepareCreate返回的理赔配置草稿。', 'sale-claim-setting-prepare-create.result.draft', { type: 'object', required: true, constraints: ['把同一份draft交给create，不重新传categoryId数组或页面展示字段。'] })
const updateDraftInput = param('prepareUpdate返回的含ID理赔配置草稿。', 'sale-claim-setting-prepare-update.result.draft', { type: 'object', required: true, constraints: ['必须保留当前id；把同一份draft交给update。'] })
const idInput = param('当前列表选定的理赔配置ID。', 'sale-claim-setting-list.list[].id，由用户明确选择', { type: 'string | number', required: true, constraints: ['必须来自当前列表或get结果，不能用claimType或名称猜测。'] })
const claimTypeInput = param('理赔类型字典value。', 'base-dict-get(dictType="claim_type").entries[].value或当前详情.claimType', { type: 'integer', required: true, lookup: { capabilityId: 'base-dict-get', args: { dictType: 'claim_type' }, valueField: 'entries[].value', labelField: 'entries[].label' } })
const gaps = ['尚未在真实测试环境执行本页列表、详情、品类树、新建、编辑、删除、原因查询、原因覆盖保存及写入后的回查；当前证据来自Portal源码、销售Java源码与离线请求断言。']

function base (purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      `只覆盖门户系统设置/销售设置下的“理赔配置”页面${pagePath}及其可达的编辑、新建和原因维护子页；不是理赔申请或独立生产菜单。`,
      `列表权限是${pagePermission}；新建、编辑、原因维护、删除分别受${createPermission}、${editPermission}、${reasonPermission}、${deletePermission}控制，SDK不绕过前端或后端授权。`,
      '所有本页请求使用Portal platform实例和VITE_ZHDJ_PLATFORM_API；claim_type字典通过已有base-dict-get读取，不伪造静态枚举。',
      '页面可达的原因维护只使用reason/list和覆盖式reason/save；后端单条原因get/create/update/delete没有页面入口，不纳入SDK。',
      '删除理赔配置会由后端同时删除该理赔类型的原因；这是不可逆业务写操作，必须先确认并回查。',
    ],
    effect,
    prerequisites: ['使用带会话token、tenantId和platform base URL的SDK；写操作的表单、ID、理赔类型和原因内容必须来自用户明确输入或当前页面数据。'],
    inputs: {},
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? 'Promise完成只表示响应通过校验；写入成功或超时后必须使用同一ID/理赔类型重新读取核对，不能只看true。' : effect === 'prepare' ? '得到无副作用草稿，尚未发送写请求。' : '返回通过结构校验的页面数据。',
    failures: ['非法ID、分页、表单、原因数量或响应形状在本地失败；权限、租户、网络和后端业务错误原样抛出。', '品类树缺少claimType时按Portal返回空数组且不发请求；不要用品类名称代替ID。'],
    idempotency: effect === 'write' ? '后端没有requestId；新建、编辑、删除或原因覆盖保存超时先回查，不盲目重发。原因保存是按claimType删除再重建。' : null,
    evidence: [
      { source: 'CodeReview_Projects_Js@test/portal/main: app/portal/menus/sale.js:197、app/portal/views/dashboard/sale/setting/claim-setting/list.vue、[mode]/[id].vue、reason/[id].vue、constants.js、common/libs/renren/list.js', kind: 'reference', note: '证明页面路径、按钮权限、分页请求、详情表单、品类联动、原因维护、提交转换和校验。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-sales/.../ClaimSettingController.java、ClaimSettingServiceImpl.java、ClaimSettingSaveReqVO.java、ClaimSettingRespVO.java', kind: 'reference', note: '证明理赔配置CRUD、分页字段、categoryId规范化、时间范围、租户数据和true回执。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-sales/.../ClaimReasonController.java、ClaimReasonServiceImpl.java、ClaimReasonSaveReqVO.java、ClaimCategoryTreeRespVO.java', kind: 'reference', note: '证明原因列表/覆盖保存、1~20条、50字符、按理赔类型删除重建和品类树字段。' },
      { source: 'src/capabilities/sale-claim-setting.ts 与 test/sale-claim-setting.test.ts', kind: 'test', note: '锁定页面端点、platform实例、表单/原因校验、prepare→submit→cancel路径和坏回执；不替代真实环境验证。' },
      { source: 'docs/pages/理赔配置.md', kind: 'reference', note: '记录本页四件套和真实环境缺口。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'sale-claim-setting-list': {
    ...base('分页查询理赔配置列表。', listOutput, ['展示claimType对应的字典标签、categoryName、startDays和endDays；total用于翻页。', '保留目标行id用于详情、编辑、删除和原因维护。']),
    inputs: {
      pageNo: param('从1开始的页码。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认1' }),
      pageSize: param('每页条数。', '调用方分页状态；Portal styleV2默认20', { type: 'integer', required: false, default: 'SDK默认20', constraints: ['接受10/20/50/100。'] }),
    },
  },
  'sale-claim-setting-get': {
    ...base('读取一条理赔配置详情并生成编辑表单所需的categoryId数组。', detailOutput, ['将结果中的claimType交给category-list加载品类树；将categoryId数组直接作为prepareUpdate的form.categoryId。']),
    inputs: { id: idInput },
    steps: [{ role: 'optional', when: '需要编辑或查看品类候选且result.claimType存在', capabilityId: 'sale-claim-setting-category-list', mapping: { claimType: 'result.claimType' }, instruction: '按当前理赔类型读取品类树。' }],
  },
  'sale-claim-setting-category-list': {
    ...base('按理赔类型读取理赔品类树。', categoryOutput, ['用户从节点catId中选择ID填入form.categoryId；catName、label只用于展示。', '缺少claimType时Portal清空树且不发请求。']),
    inputs: { claimType: { ...claimTypeInput, required: false, constraints: ['缺省时返回[]且不发请求；有值时必须来自claim_type字典。'] } },
  },
  'sale-claim-setting-reason-list': {
    ...base('按理赔类型读取原因维护页的当前原因列表。', reasonOutput, ['展示每条content；编辑原因维护页时保留id，但保存是按理赔类型覆盖，不按id单条更新。']),
    inputs: { claimType: claimTypeInput },
  },
  'sale-claim-setting-prepare-create': {
    ...base('按Portal表单规则整理新建理赔配置草稿，不发送create。', prepareCreateOutput, ['先用base-dict-get取得claim_type；需要品类时先调用category-list。', '用户取消只丢弃draft；明确确认后把同一draft交给create。'], 'prepare'),
    inputs: { form: formInput },
    steps: [
      { role: 'optional', when: '需要选择品类', capabilityId: 'sale-claim-setting-category-list', mapping: { claimType: 'user.form.claimType' }, instruction: '从按类型返回的树中选择catId。' },
      { role: 'required', when: '用户明确确认新建', capabilityId: 'sale-claim-setting-create', mapping: { draft: 'result.draft' }, instruction: '提交同一份草稿；不要把id、categoryName或categoryId数组重新拼入。' },
      { role: 'cancel', when: '用户取消新建', instruction: '只丢弃草稿，不发送create。' },
    ],
  },
  'sale-claim-setting-create': {
    ...base('创建一条用户确认的理赔配置。', trueOutput, ['返回true只表示后端接受请求；创建成功或超时后刷新list，按claimType和关键字段核对，不能从true猜新ID。'], 'write'),
    inputs: { draft: createDraftInput },
    steps: [{ role: 'recovery', when: 'create返回true、超时或响应丢失后核实结果', capabilityId: 'sale-claim-setting-list', mapping: {}, instruction: '重新分页查询并按claimType、categoryId、startDays、endDays核对；匹配不唯一时停止猜测。' }],
  },
  'sale-claim-setting-prepare-update': {
    ...base('按Portal表单规则整理现有理赔配置编辑草稿，不发送update。', prepareUpdateOutput, ['先调用get并保留id；用户取消只丢弃draft，确认后把同一draft交给update。'], 'prepare'),
    inputs: { form: formInput },
    steps: [
      { role: 'required', when: '开始编辑当前记录', capabilityId: 'sale-claim-setting-get', mapping: { id: 'user.form.id' }, instruction: '读取详情并使用返回的categoryId数组回填表单。' },
      { role: 'required', when: '用户明确确认编辑', capabilityId: 'sale-claim-setting-update', mapping: { draft: 'result.draft' }, instruction: '提交同一份含当前id的草稿。' },
      { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃草稿，不发送update。' },
    ],
  },
  'sale-claim-setting-update': {
    ...base('更新一条用户确认的理赔配置。', trueOutput, ['返回true只表示后端接受；成功或超时后按draft.id调用get逐字段核对，尤其核对categoryId和时间范围。'], 'write'),
    inputs: { draft: updateDraftInput, 'draft.id': param('当前理赔配置ID。', 'sale-claim-setting-prepare-update.result.draft.id', { type: 'string | number', required: true }) },
    steps: [{ role: 'recovery', when: 'update返回true、超时或响应丢失后核实结果', capabilityId: 'sale-claim-setting-get', mapping: { id: 'args.draft.id' }, instruction: '读取同一ID详情并逐字段核对。' }],
  },
  'sale-claim-setting-prepare-remove': {
    ...base('准备删除当前列表选定的理赔配置，不发送DELETE。', removeOutput, ['向用户展示claimType和categoryName并明确提示该类型原因也会被删除；取消只丢弃id。'], 'prepare'),
    inputs: { id: idInput },
    steps: [
      { role: 'required', when: '用户明确确认删除', capabilityId: 'sale-claim-setting-remove', mapping: { id: 'result.id' }, instruction: '提交同一当前列表记录ID。' },
      { role: 'cancel', when: '用户取消删除', instruction: '只丢弃删除草稿，不发送DELETE。' },
    ],
  },
  'sale-claim-setting-remove': {
    ...base('删除一条理赔配置及其理赔类型原因。', trueOutput, ['返回true只表示后端接受；删除成功或超时后刷新list确认目标ID消失，并用reason-list确认该类型原因状态。'], 'write'),
    inputs: { id: idInput },
    steps: [{ role: 'recovery', when: 'remove返回true、超时或响应丢失后核实结果', capabilityId: 'sale-claim-setting-list', mapping: {}, instruction: '刷新列表并确认同一ID不再出现；超时先回查，不盲目重删。' }],
  },
  'sale-claim-setting-prepare-save-reasons': {
    ...base('按原因维护页规则整理覆盖式原因草稿，不发送reason/save。', prepareReasonsOutput, ['原因必须保留1~20条，文本去除首尾空白后不能为空，长度最多50字符，页面按原文本检查重复。', '用户取消只丢弃draft；空数组不是清空，而是后端拒绝。'], 'prepare'),
    inputs: {
      claimConfigId: param('当前理赔配置ID。', '当前原因维护路由id或sale-claim-setting-list.list[].id', { type: 'string | number', required: true }),
      claimType: claimTypeInput,
      reasons: param('原因列表。', 'sale-claim-setting-reason-list.result或用户在原因维护页新增/删除后的表单', { type: 'object[]', required: true, constraints: ['必须1~20条；每条content非空且最多50字符；不能存在原文本完全相同的重复项。'] }),
    },
    steps: [
      { role: 'optional', when: '进入原因维护页', capabilityId: 'sale-claim-setting-reason-list', mapping: { claimType: 'args.claimType' }, instruction: '读取当前原因并让用户编辑；不要调用后端未使用的单条原因接口。' },
      { role: 'required', when: '用户明确确认保存原因', capabilityId: 'sale-claim-setting-save-reasons', mapping: { draft: 'result.draft' }, instruction: '提交同一份覆盖式草稿。' },
      { role: 'cancel', when: '用户取消原因维护', instruction: '只丢弃草稿，不发送reason/save。' },
    ],
  },
  'sale-claim-setting-save-reasons': {
    ...base('覆盖保存一条理赔配置的全部理赔原因。', trueOutput, ['后端先按claimType删除旧原因，再按顺序插入本次1~20条内容；返回true不代表已回查。'], 'write'),
    inputs: {
      draft: param('prepareSaveReasons返回的原因草稿。', 'sale-claim-setting-prepare-save-reasons.result.draft', { type: 'object', required: true }),
      'draft.claimType': param('原因草稿中的理赔类型。', 'sale-claim-setting-prepare-save-reasons.result.draft.claimType', { type: 'integer', required: true }),
    },
    steps: [{ role: 'recovery', when: 'saveReasons返回true、超时或响应丢失后核实结果', capabilityId: 'sale-claim-setting-reason-list', mapping: { claimType: 'args.draft.claimType' }, instruction: '重新读取原因列表，按顺序和content逐项核对；不以成功提示替代回查。' }],
  },
}

export const SALE_CLAIM_SETTING_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALE_CLAIM_SETTING_METHODS).map(id => [id, contracts[id]!]))
export const SALE_CLAIM_SETTING_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALE_CLAIM_SETTING_METHODS).map(([id, method]) => [`saleClaimSetting.${method}`, SALE_CLAIM_SETTING_AI_CONTRACTS[id]!]))
