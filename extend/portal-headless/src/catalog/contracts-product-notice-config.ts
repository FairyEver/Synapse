import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  PRODUCT_NOTICE_CONFIG_METHODS,
  productNoticeConfigCapabilities,
} from '../capabilities/product-notice-config.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(productNoticeConfigCapabilities.map(definition => [definition.id, definition]))

const pageFields: AiField[] = [
  field('$', 'object', '知会配置分页结果；list是当前页，total是筛选后的总条数。'),
  field('list', 'object[]', '当前页的知会配置行。'),
  field('list[].id', 'string | number | null', '列表行ID；Portal删除动作直接把它作为id发送。', { nullable: true, nullMeaning: 'Java DTO构造器可能未复制原实体ID；此时页面删除请求本身可能不可用' }),
  field('list[].title', 'string | null', '推送名称。', { nullable: true, nullMeaning: '后端未返回名称' }),
  field('list[].module', 'integer | null', '模块数字值。', { nullable: true, nullMeaning: '后端未返回模块' }),
  field('list[].moduleName', 'string | null', '模块展示名称。', { nullable: true, nullMeaning: '后端未返回模块名称' }),
  field('list[].indicatorName', 'string | null', '指标名称。', { nullable: true, nullMeaning: '后端未返回指标' }),
  field('list[].params', 'string | null', '推送参数模板字符串。', { nullable: true, nullMeaning: '后端未返回参数模板' }),
  field('list[].postIdList', 'integer[] | null', '推送岗位ID数组；编辑时作为表单岗位选择值。', { nullable: true, nullMeaning: '后端未返回岗位数组' }),
  field('list[].postName', 'string | null', '推送岗位展示名称，多个岗位以逗号连接。', { nullable: true, nullMeaning: '后端未返回岗位名称' }),
  field('list[].task', 'string | null', '关联任务。', { nullable: true, nullMeaning: '后端未返回关联任务' }),
  field('list[].jumpPage', 'string | null', '通知点击后的跳转页面。', { nullable: true, nullMeaning: '后端未返回跳转页面' }),
  field('list[].status', 'integer | null', '状态：1启用、0停用。', { nullable: true, nullMeaning: '后端未返回状态' }),
  field('list[].statusName', 'string | null', '状态展示名称。', { nullable: true, nullMeaning: '后端未返回状态名称' }),
  field('total', 'integer', '当前筛选条件下的总条数；不是当前页长度。'),
]

const commonBoundaries = [
  '页面路径是/dashboard/product/operation/notice-config/list，权限码是/dashboard/product/operation/notice-config；请求使用product实例，补devicetype=PC，不发送module-type。',
  '模块、岗位和级联候选都来自本页面实际调用的config/notification接口；不能把高产/稳产统计页的模块或岗位候选混用。',
  'Portal列表默认title/module/postId/status均为空字符串，pageNo=1、pageSize=20，SDK复刻order/orderField为空字符串和页面支持的10/20/50/100分页值。',
  '页面源码是本轮请求形状的直接基准；Java源码用于核对实际字段和后端端点，源码不一致时SDK不替Portal偷偷修正请求。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/product/operation.js 与 app/portal/views/dashboard/product/operation/notice-config/list.vue', kind: 'reference', note: '逐页核对菜单路径、权限、product实例、列表筛选、模块候选、删除和启停请求。' },
  { source: 'app/portal/views/dashboard/product/operation/notice-config/[mode]/[id].vue 与 app/portal/components/portal/product/select/post/index.vue', kind: 'reference', note: '逐字段核对保存表单、八项必填规则、级联选项、岗位选项和取消行为。' },
  { source: 'NotificationConfigController、NotificationConfig、NotificationConfigDTO、NotificationConfigMapperExt.xml、NotificationConfigServiceImpl', kind: 'reference', note: '核对分页、候选、保存、Java删除/启停接口、分组字段和保存时按标题+模块替换的服务逻辑。' },
  { source: 'src/capabilities/product-notice-config.ts 与 test/product-notice-config.test.ts', kind: 'implementation', note: '锁定页面实际请求、表单规则、响应字段和Portal/Java删除路径偏差；不替代真实环境浏览器证据。' },
  { source: 'docs/pages/知会配置.md', kind: 'reference', note: '记录页面四件套、写入回查要求和证据边界。' },
]

const gaps = [
  '已逐页核对Portal页面、菜单、Java Controller/Entity/DTO/Mapper/Service、SDK实现和离线反证测试；尚未在真实测试环境执行列表、保存、删除或启停请求。',
  'Portal删除调用为DELETE /noticeConfig/delete?id，而Java当前Controller只有GET /flockSimu/config/notification/delete?title&module；SDK忠实复刻页面请求并将该不一致作为风险，不把它描述为已验证可删除。',
]

const queryInputs: Record<string, AiParameter> = {
  title: param('推送名称前缀筛选；省略时发送空字符串。', '用户输入或页面默认值', { type: 'string', required: false, default: '' }),
  module: param('模块值；省略时发送空字符串。', '模块候选的value或页面默认值', { type: 'string | number', required: false, default: '' }),
  postId: param('推送岗位ID筛选；省略时发送空字符串。', '岗位候选的value或页面默认值', { type: 'string | number', required: false, default: '' }),
  status: param('状态筛选：0停用、1启用、空字符串全部。', '用户选择或页面默认值', { type: '0 | 1 | ""', required: false, default: '' }),
  pageNo: param('从1开始的页码。', '调用方分页状态', { type: 'integer', required: false, default: '1' }),
  pageSize: param('页面支持的每页条数。', '调用方分页状态', { type: '10 | 20 | 50 | 100', required: false, default: '20' }),
}

const formInputs: Record<string, AiParameter> = {
  form: param('Portal知会配置表单；module、title、task、jumpPage、indicatorName、params、status、postIdList均必填。', '用户确认的页面表单', { type: 'object', required: true, constraints: ['status为0/1或页面默认字符串"1"', 'postIdList必须为非空岗位ID数组'] }),
}

const listContract: AiContract = {
  purpose: '按推送名称、模块、岗位和状态查询知会配置分页列表。',
  whenToUse: '进入知会配置页、提交筛选或写入后回查页面记录时使用。',
  effect: 'read',
  inputs: queryInputs,
  output: { shape: '{ list: object[], total: integer }', fields: pageFields, empty: 'list=[]且total=0表示当前筛选无配置；权限、网络、业务或响应形状错误会抛出。' },
  consume: ['用list[].title、moduleName、indicatorName、params、postName、task、jumpPage和statusName展示列表；编辑时保留同一行的module、title、task、jumpPage、indicatorName、params、status和postIdList。', '删除前必须确认list[].id是页面将要发送的ID；不要仅凭title/module推断Portal删除已经可用。'],
  boundaries: [...commonBoundaries, 'Portal customLoad读取res.page或res本身；SDK接受同等分页层级但最终只返回{list,total}。'],
  prerequisites: ['用户拥有/dashboard/product/operation/notice-config权限，并使用当前租户会话。'],
  steps: [],
  completion: '返回当前页行和总数；空分页是合法数据结果。',
  failures: ['非法分页值、分页响应缺少list/total、权限、网络或后端错误抛出。'],
  idempotency: null,
  evidence,
  gaps,
}

const moduleContract: AiContract = {
  purpose: '读取知会配置页面的模块候选。',
  whenToUse: '打开列表或保存表单，需要填充模块选择器时调用。',
  effect: 'read',
  inputs: {},
  output: { shape: 'object[]', fields: [field('$', 'object[]', '模块候选数组'), field('[].value', 'string', '提交给表单module的模块数字字符串'), field('[].label', 'string', '模块展示名称')], empty: '[]表示当前会话没有可选模块。' },
  consume: ['把value提交给prepareSave的module；不要把label当作module。'],
  boundaries: [...commonBoundaries, '请求为GET /config/notification/getModuleList；Portal直接消费moduleList数组。'],
  prerequisites: ['用户拥有页面权限。'], steps: [], completion: '返回可供页面模块选择器使用的value/label数组。', failures: ['响应不是模块数组、权限或网络错误抛出。'], idempotency: null, evidence, gaps,
}

const postContract: AiContract = {
  purpose: '读取知会配置页面的岗位候选。',
  whenToUse: '打开保存表单，需要填充推送岗位多选器时调用。',
  effect: 'read',
  inputs: {},
  output: { shape: 'object[]', fields: [field('$', 'object[]', '岗位候选数组'), field('[].value', 'integer', '岗位ID；Portal组件将原始值转为数字'), field('[].label', 'string', '岗位名称')], empty: '[]表示当前租户没有可选岗位。' },
  consume: ['把value组成非空postIdList提交；不要提交岗位label。'],
  boundaries: [...commonBoundaries, '请求为GET /config/notification/getPostList；SDK返回Portal组件最终消费的数字value。'],
  prerequisites: ['用户拥有页面权限和当前租户岗位可见范围。'], steps: [], completion: '返回岗位数字ID和展示名称。', failures: ['岗位值不是正整数、权限或网络错误抛出。'], idempotency: null, evidence, gaps,
}

const chooseContract: AiContract = {
  purpose: '读取推送名称、关联任务、跳转页面、指标名称和推送参数的五级级联候选。',
  whenToUse: '打开新建/编辑表单或用户改变上级选项，需要重置并填充下级选择器时调用。',
  effect: 'read',
  inputs: {},
  output: { shape: 'object[]', fields: [field('$', 'object[]', '模块根节点数组'), field('[].value', 'string', '当前级联值'), field('[].label', 'string', '当前级联展示名称'), field('[].childList', 'object[]', '下一级候选；继续按同样value/label/childList结构读取')], empty: '[]表示没有可用级联配置。' },
  consume: ['选择上级后只在对应childList中找下一级；切换上级时清空页面后续值，不能跨树级复用旧值。'],
  boundaries: [...commonBoundaries, '请求为GET /config/notification/getChoose；Portal兼容数组或res.list，SDK同样只接受这两种结果。'],
  prerequisites: ['用户拥有页面权限。'], steps: [], completion: '返回完整递归级联树。', failures: ['节点缺少value/label/childList、权限或网络错误抛出。'], idempotency: null, evidence, gaps,
}

const prepareContract: AiContract = {
  purpose: '在本地校验Portal知会配置表单并生成可提交草稿，不发送网络请求。',
  whenToUse: '用户确认模块、推送名称、关联任务、跳转页面、指标、参数、状态和至少一个岗位后调用。',
  effect: 'prepare',
  inputs: formInputs,
  output: { shape: '{ draft: object }', fields: [field('$', 'object', '本地准备结果'), field('draft', 'object', '保留Portal表单字段并通过必填、状态和岗位数组校验的草稿')], empty: '输入非法时抛错且不发送请求。' },
  consume: ['用户取消时直接丢弃draft；确认提交时把同一个draft传给save。'],
  boundaries: [...commonBoundaries, '表单必填规则逐项复刻Portal：title/module/indicatorName/params/task/jumpPage/status/postIdList；SDK不替页面自动选岗位或级联值。'],
  prerequisites: ['已从moduleList、choose和postList取得候选，并由用户确认最终值。'], steps: [], completion: '得到可交给save的draft，尚未改变服务端。', failures: ['任一必填文本为空、status不是0/1、postIdList为空或岗位ID非法时抛错。'], idempotency: null, evidence, gaps,
}

const saveContract: AiContract = {
  purpose: '保存一条知会配置；Java服务会按title+module删除旧配置，再为postIdList中的岗位批量插入。',
  whenToUse: 'prepareSave通过且用户明确确认保存时调用。',
  effect: 'write',
  inputs: { draft: param('prepareSave返回的完整草稿；不要自行删除页面字段。', 'productNoticeConfig.prepareSave.result.draft', { type: 'object', required: true }) },
  output: { shape: 'boolean', fields: [field('$', 'boolean', '请求成功完成的本地确认；接口没有业务实体ID返回')], empty: '请求抛错时没有成功结果；true也不等于已完成列表回查。' },
  consume: ['成功或超时后调用list，按title、module和postIdList回查；不要仅凭true认定所有岗位已落库。'],
  boundaries: [...commonBoundaries, '调用顺序是prepareSave → save；请求严格为POST /flockSimu/config/notification/save，body是Portal表单草稿；取消只丢弃draft，不调用保存接口。', '后端保存不是按单个id更新，而是按title+module删除旧配置后批量插入岗位关系；同title+module的旧配置会被替换。'],
  prerequisites: ['准备草稿已通过；用户拥有后端写权限；调用方已明确替换同title+module旧配置的影响。'], steps: [{ role: 'required', when: '保存成功或请求超时需要核实', capabilityId: 'product-notice-config-list', mapping: { title: 'args.draft', module: 'args.draft' }, instruction: '从draft中取title和module回查分页结果，逐项核对岗位、状态、任务、跳转页面、指标和参数；不要只看POST完成。' }, { role: 'cancel', when: '用户在提交前取消', instruction: '丢弃draft，不调用网络接口；服务端没有针对本地草稿的取消接口。' }],
  completion: 'POST完成且列表回查确认配置已按用户确认字段出现后，才算保存已验证。',
  failures: ['必填字段非法、权限/网络/业务错误抛出；超时结果不确定，必须list回查后再决定是否重试。'],
  idempotency: '没有requestId幂等键；服务端按title+module替换旧配置，超时不要盲目重复保存，先按同一title+module回查。', evidence, gaps,
}

const removeContract: AiContract = {
  purpose: '复刻Portal列表删除按钮提交的知会配置删除请求。',
  whenToUse: '用户明确点击列表删除且当前行存在Portal使用的record.id时调用。',
  effect: 'write',
  inputs: { id: param('当前列表行record.id；不是title、module或数组下标。', 'productNoticeConfig.list.result.list[].id', { type: 'string | number', required: true }) },
  output: { shape: 'boolean', fields: [field('$', 'boolean', '删除请求完成的本地确认；没有业务实体回执')], empty: '请求抛错时没有成功结果。' },
  consume: ['成功或超时后list回查目标行；由于Portal与Java删除路由存在偏差，必须把回查失败报告为未验证。'],
  boundaries: [...commonBoundaries, 'SDK严格复刻Portal：DELETE /noticeConfig/delete，查询参数只有id。', 'Java当前NotificationConfigController实际声明的是GET /flockSimu/config/notification/delete，参数为title和module，没有Portal DELETE /noticeConfig/delete映射；SDK不擅自改成Java路径。'],
  prerequisites: ['用户明确确认删除，且当前列表行id非空。'], steps: [{ role: 'required', when: '删除成功或超时需要核实', capabilityId: 'product-notice-config-list', mapping: { title: 'context.title', module: 'context.module' }, instruction: '用调用前保留的原列表行title和module重新读取列表核对目标行是否仍存在；若后端路由不匹配，报告未删除而不是猜测成功。' }, { role: 'cancel', when: '用户在调用前取消', instruction: '不调用DELETE接口；该页面没有服务端恢复已删除配置的Portal动作。' }], completion: '仅当删除请求完成且列表回查确认目标行消失，才算删除已验证。', failures: ['id为空、权限/网络/路由/业务错误抛出；超时不要自动重试，先list回查。'], idempotency: '页面没有requestId；同一个id重复删除的结果取决于后端路由和记录状态，必须先回查。', evidence, gaps,
}

const toggleContract: AiContract = {
  purpose: '按列表行当前状态切换知会配置启用/停用。',
  whenToUse: '用户明确点击启用或停用动作，且输入来自最新列表行时调用。',
  effect: 'write',
  inputs: { title: param('当前行推送名称。', 'productNoticeConfig.list.result.list[].title', { type: 'string', required: true }), module: param('当前行模块数字值。', 'productNoticeConfig.list.result.list[].module', { type: 'number', required: true }), status: param('当前行状态：0停用或1启用；SDK按Portal严格计算目标字符串。', 'productNoticeConfig.list.result.list[].status', { type: '0 | 1', required: true }) },
  output: { shape: 'boolean', fields: [field('$', 'boolean', '启停请求完成的本地确认；没有业务状态回执')], empty: '请求抛错时没有成功结果。' },
  consume: ['成功或超时后list回查同title+module，确认status和statusName已改变；不要把请求成功当成状态已持久化。'],
  boundaries: [...commonBoundaries, '请求严格为GET /config/notification/enableOrDisable，参数为title、module和status；Portal将当前数字1变成字符串0，当前数字0变成字符串1。', 'Java服务按title+module批量更新相关岗位记录；状态切换不是单个id更新。'],
  prerequisites: ['title、module、status来自最新列表行，用户明确确认启停。'], steps: [{ role: 'required', when: '启停成功或超时需要核实', capabilityId: 'product-notice-config-list', mapping: { title: 'args.title', module: 'args.module' }, instruction: '回查同title+module的行，核对status/statusName；若结果仍是旧值，不要重复反转，先判断请求是否已到达。' }, { role: 'cancel', when: '用户在调用前取消', instruction: '不调用启停接口。' }], completion: '启停请求完成且列表回查确认目标状态后，才算启停已验证。', failures: ['状态不是0/1、权限/网络/业务错误抛出；超时结果不确定，必须先回查。'], idempotency: '接口是目标状态字符串但输入是当前状态；重试前必须重新读取当前状态，避免把已生效状态再次反转。', evidence, gaps,
}

const contracts: Record<string, AiContract> = {
  'product-notice-config-list': listContract,
  'product-notice-config-module-list': moduleContract,
  'product-notice-config-post-list': postContract,
  'product-notice-config-choose': chooseContract,
  'product-notice-config-prepare-save': prepareContract,
  'product-notice-config-save': saveContract,
  'product-notice-config-remove': removeContract,
  'product-notice-config-toggle-status': toggleContract,
}

for (const id of Object.keys(contracts)) {
  if (!definitions.has(id)) throw new Error(`知会配置契约没有对应能力定义：${id}`)
}

export const PRODUCT_NOTICE_CONFIG_AI_CONTRACTS = contracts
export const PRODUCT_NOTICE_CONFIG_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_NOTICE_CONFIG_METHODS).map(([id, method]) => [
    `productNoticeConfig.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为 productNoticeConfig.${method}；写入方法遵循契约中的回查和取消步骤。`] },
  ]),
)
