import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_LIVESTOCK_AMORTIZATION_METHODS } from '../capabilities/finance-setting-livestock-amortization.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: false,
  nullable: false,
  ...extra,
})
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })

const pagePath = '/dashboard/finance/setting/livestock-amortization/list'
const permission = '/dashboard/finance/setting/livestock-amortization'
const root = '/admin-api/finance/biological-asset-depreciation-config'
const idRules = ['安全正整数或无前导零的正整数字符串', '长ID保留字符串，不能用名称、列表下标或租户名称代替']
const statusOptions = [{ value: 0, label: '停用' }, { value: 1, label: '启用' }]

const rowFields = (prefix: string): AiField[] => [
  field(`${prefix}.id`, 'string | number', '种畜摊销设置主键；不是代次、品种或列表下标', { constraints: idRules }),
  field(`${prefix}.generation`, 'string', '代次选择值；页面以gen字典显示', { nullable: true, nullMeaning: '后端没有代次' }),
  field(`${prefix}.breed`, 'string', '品种选择值；页面以variety字典显示', { nullable: true, nullMeaning: '后端没有品种' }),
  field(`${prefix}.line`, 'string', '品系选择值；页面以line字典显示', { nullable: true, nullMeaning: '后端没有品系' }),
  field(`${prefix}.depreciationMethod`, 'integer | string', '种摊计提方法；页面以depreciation_method字典显示，当前表单控件禁用', { nullable: true, nullMeaning: '后端没有计提方法' }),
  field(`${prefix}.accrualAgeDays`, 'integer | string', '计提种摊日龄；页面列表列值', { nullable: true, nullMeaning: '后端没有日龄' }),
  field(`${prefix}.accrualAgeCoefficient`, 'number | string', '计提种摊日龄系数；Decimal原值，保留数字或十进制字符串', { nullable: true, nullMeaning: '后端没有系数' }),
  field(`${prefix}.accrualMaxDays`, 'integer | string', '种摊提取天数；页面列表列值', { nullable: true, nullMeaning: '后端没有提取天数' }),
  field(`${prefix}.netSalvageRate`, 'number | string', '净残值率；页面约束为0到1，Decimal原值', { nullable: true, nullMeaning: '后端没有净残值率' }),
  field(`${prefix}.accrualRatio`, 'number | string', '后端保存的计提比例；当前页面列表和创建表单不展示', { nullable: true, nullMeaning: '后端没有计提比例' }),
  field(`${prefix}.status`, 'integer', '记录状态：0停用、1启用；列表启停使用绝对值', { values: { '0': '停用', '1': '启用' } }),
  field(`${prefix}.flockStatus`, 'integer | string', '鸡群状态；页面以chicken_status字典显示', { nullable: true, nullMeaning: '未选择鸡群状态' }),
  field(`${prefix}.createTime`, 'string | number', '创建时间原值；SDK不做时区转换', { nullable: true, nullMeaning: '后端没有创建时间' }),
  field(`${prefix}.updateTime`, 'string | number', '更新时间原值；SDK不做时区转换', { nullable: true, nullMeaning: '后端没有更新时间' }),
  field(`${prefix}.tenantName`, 'string', '租户名称；不是调用方筛选或提交ID', { nullable: true, nullMeaning: '后端没有租户名称' }),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [field('$', 'object', '种畜摊销设置当前分页结果'), field('list', 'array', '当前页列表；不是全部匹配记录'), field('list[]', 'object', '一条种畜摊销设置列表行'), ...rowFields('list[]'), field('total', 'integer', '筛选结果总数；不是当前页长度', { constraints: ['非负整数'] })],
  empty: 'list=[]且total=0表示筛选结果为空；权限、网络或响应结构错误会抛错，不改写为空列表。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object | null',
  fields: [field('$', 'object | null', '种畜摊销设置详情；不存在时为null', { nullable: true, nullMeaning: '后端返回空详情或记录不存在' }), ...rowFields('$')],
  empty: '详情响应不是null或完整对象时抛错；null不代表创建或编辑成功。',
}

const draftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('$', 'object', '尚未发网络请求的创建草稿'),
    field('draft', 'object', 'Portal /create 请求体'),
    field('draft.id', 'string | number', '调用方显式传入时保留的主键；当前页面编辑态仍错误地POST /create，不能把它当成更新结果', { optional: true, nullable: false, constraints: idRules }),
    field('draft.generation', 'string', '代次；非空且最多100个字符'),
    field('draft.breed', 'string', '品种；非空且最多100个字符'),
    field('draft.line', 'string | null', '品系；最多100个字符，缺省为null', { nullable: true, nullMeaning: '未选择品系' }),
    field('draft.depreciationMethod', 'string | number | null', '计提方法；缺省为字符串1，与Portal初始化表单一致', { nullable: true, nullMeaning: '调用方显式传入null' }),
    field('draft.accrualAgeDays', 'number | null', '计提种摊日龄；Portal customSubmit按truthy规则转数字', { nullable: true, nullMeaning: '输入数字0会按Portal源码转成null或调用方显式传入null' }),
    field('draft.accrualAgeCoefficient', 'number | null', '计提种摊日龄系数；Portal customSubmit按truthy规则转数字', { nullable: true, nullMeaning: '调用方显式传入null或输入数字0按源码转null' }),
    field('draft.accrualMaxDays', 'number | null', '种摊提取天数；整数且最小0，Portal customSubmit按truthy规则转数字', { nullable: true, nullMeaning: '输入数字0会按Portal源码转成null' }),
    field('draft.netSalvageRate', 'number | null', '净残值率；0到1，Portal customSubmit按truthy规则转数字', { nullable: true, nullMeaning: '输入数字0会按Portal源码转成null' }),
    field('draft.accrualRatio', 'string | number | null', '只有调用方显式提供时才随展开字段发送；当前创建表单没有该字段', { optional: true, nullable: true, nullMeaning: '调用方未提供后端计提比例' }),
    field('draft.flockStatus', 'string | number | null', '鸡群状态；表单没有必填规则，缺省为null', { nullable: true, nullMeaning: '未选择鸡群状态' }),
  ],
  empty: '必填项、长度、数字范围或页面请求形状非法时抛错，不返回半成品草稿。',
}

const statusOutput: AiContract['output'] = {
  shape: '{ draft: { id: string | number, status: 0 | 1 }, previous: { id: string | number, status: 0 | 1 } }',
  fields: [
    field('$', 'object', '尚未发网络请求的启停草稿'),
    field('draft', 'object', '提交给setStatus的绝对目标状态'),
    field('draft.id', 'string | number', '记录主键；来自最新列表行', { constraints: idRules }),
    field('draft.status', 'integer', '绝对目标状态：0停用、1启用；必须与previous.status相反', { values: { '0': '停用', '1': '启用' } }),
    field('previous', 'object', '生成草稿时的当前状态快照；不是自动回滚指令'),
    field('previous.id', 'string | number', '当前行主键', { constraints: idRules }),
    field('previous.status', 'integer', '当前行状态：0停用或1启用', { values: { '0': '停用', '1': '启用' } }),
  ],
  empty: 'current与targetStatus非法或目标状态未变化时抛错，不发请求。',
}

const coefficientOutput: AiContract['output'] = {
  shape: 'number | null',
  fields: [field('$', 'number | null', '按(1-netSalvageRate)/accrualMaxDays计算的日龄系数；非正结果或缺少有效天数时为null', { nullable: true, nullMeaning: '输入缺失、非法、提取天数不大于0或结果不大于0' })],
  empty: '这是页面本地计算，不发网络请求；null不能当作服务端已保存的系数。',
}

const boundaries = [
  `只覆盖页面${pagePath}实际可达的分页、详情读取、新建、启停和本地系数计算；页面没有编辑、删除或导出按钮。`,
  `页面权限是${permission}；新建和启停按钮分别受finance:setting:livestock-amortization:create、finance:setting:livestock-amortization:status裁决，SDK不替页面预判权限。`,
  `页面列表通过POST ${root}/page发送完整表单；默认status=1、三组多选为空数组、pageNo=1、pageSize=20，并保留order/orderField空字符串。`,
  '表单编辑路由的customSubmit仍固定POST /create，虽然Java存在PUT /update；因为当前列表没有编辑入口，SDK不发布update能力，也不把该源码缺陷解释成编辑成功。',
  `Portal启停源码把{ params: { id, status } }作为PUT第二参数，实际是请求body；SDK按源码发送data.params，并在契约中标记它与Java @RequestParam的静态冲突。`,
  'Decimal字段保留数字或十进制字符串；长ID保留字符串。module-type按页面推导为null，使用platform实例。',
]
const prerequisites = [
  '调用方需使用绑定当前用户、租户和会话token的platform SDK；页面权限和后端业务校验由服务端裁决。',
  '写操作先prepareCreate或prepareSetStatus，再由用户确认后submit；提交成功或超时都必须list/get回查，不能只看HTTP成功。',
  '启停prepare应使用最新列表行的id/status；不要在调用方用toggle或按旧状态盲切换。',
]
const failures = [
  'ID、状态、分页、字典多选、必填字段、长度、非数字、整数、净残值率范围或目标状态未变化时在发请求前抛错。',
  '分页、详情或写回执形状错误时抛错，不把坏响应改写为空列表、空详情或成功。',
  '401/403、网络错误、创建重复配置和后端校验错误原样失败；本地规则不能替代服务端唯一性校验。',
  '启停请求超时后先按同一id回查status；页面没有cancel/delete/恢复接口，不能伪造撤销。',
]
const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main app/portal/menus/finance.js 与 app/portal/views/dashboard/finance/setting/livestock-amortization.vue', kind: 'reference', note: '证明菜单路径、页面权限和路由。' },
  { source: 'CodeReview_Projects_Js@test/portal/main app/portal/views/dashboard/finance/setting/livestock-amortization/list.vue、[mode]/[id].vue、common/libs/renren/list.js、common/libs/renren/form.js', kind: 'reference', note: '证明列表POST分页、默认表单、按钮权限、可见动作、表单字段规则、数字转换、详情GET、固定create提交和本地公式。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test BiologicalAssetDepreciationConfigController、SaveReqVO、PageReqVO、RespVO、BiologicalAssetDepreciationConfigServiceImpl', kind: 'reference', note: '证明后端端点、字段、必填/长度校验、默认启用、重复启用规则、状态参数和响应字段。' },
  { source: 'src/capabilities/finance-setting-livestock-amortization.ts', kind: 'implementation', note: '证明SDK请求体、Portal数字转换、严格响应投影、状态body形状和页面能力边界。' },
  { source: 'test/finance-setting-livestock-amortization.test.ts', kind: 'test', note: '证明逐页源码核对、默认请求、表单提交、启停、公式、坏响应和反证；不宣称真实环境写入。' },
]

function contract (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence'> & Partial<Pick<AiContract, 'boundaries' | 'prerequisites' | 'failures' | 'evidence'>>): AiContract {
  return {
    whenToUse: `操作Portal“财务设置→种畜摊销设置”页面；不要把Java存在但当前列表不可达的${root}/update或${root}/export-excel误报为页面能力。`,
    boundaries,
    prerequisites,
    failures,
    evidence,
    gaps: [
      '本轮未启动浏览器，未取得该页面独立真实网络基准、实际按钮权限结果或部署响应变体；契约依据是已拉取的Portal/Java源码和离线测试。',
      '尚未在真实测试环境执行创建、启停的prepare→submit→回查完整写闭环；不能把离线请求替身称为线上写入证据。',
    ],
    ...value,
  }
}

const createSteps = [{ role: 'required' as const, when: '用户确认创建且拥有finance:setting:livestock-amortization:create权限', capabilityId: 'finance-setting-livestock-amortization-create', mapping: { draft: 'result.draft' }, instruction: '只提交prepareCreate返回的draft；返回ID后回查列表。' }]
const statusSteps = [{ role: 'required' as const, when: '用户确认启停且拥有finance:setting:livestock-amortization:status权限', capabilityId: 'finance-setting-livestock-amortization-set-status', mapping: { draft: 'result.draft' }, instruction: '只提交prepareSetStatus返回的绝对draft.status。' }]

export const FINANCE_SETTING_LIVESTOCK_AMORTIZATION_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-livestock-amortization-list': contract({
    purpose: '按Portal页面状态、代次、品种、品系和分页条件读取种畜摊销设置列表。',
    effect: 'read',
    inputs: {
      order: optional('排序字段；页面没有排序控件。', '列表模块排序状态', '发送空字符串', { type: 'string' }),
      orderField: optional('排序方向；页面没有排序控件。', '列表模块排序状态', '发送空字符串', { type: 'string' }),
      status: optional('记录状态：0停用或1启用。', '页面状态单选框', '使用1启用', { type: 'integer', options: statusOptions }),
      generations: optional('代次多选值数组。', '页面代次选择器', '发送空数组，不按代次筛选', { type: 'array' }),
      breeds: optional('品种多选值数组。', '页面品种选择器', '发送空数组，不按品种筛选', { type: 'array' }),
      lines: optional('品系多选值数组。', '页面品系选择器', '发送空数组，不按品系筛选', { type: 'array' }),
      pageNo: optional('从1开始的页码。', '列表分页状态', '使用1', { type: 'integer', constraints: ['正整数'] }),
      pageSize: optional('每页条数。', '列表分页状态', '使用20；只能是10、20、50、100', { type: 'integer', constraints: ['只能是10、20、50或100'] }),
    },
    output: pageOutput,
    consume: ['展示代次、品种、品系、鸡群状态、计提方法、日龄、系数、提取天数、净残值率和更新时间。', '保留list[].id与list[].status；启停前用最新行生成prepareSetStatus。', 'list=[]且total=0是业务空结果，不等于权限成功。'],
    steps: [],
    completion: '返回当前筛选条件下严格校验的一页结果；不代表发生任何写入。',
    idempotency: null,
  }),

  'finance-setting-livestock-amortization-get': contract({
    purpose: '读取Portal表单编辑路由使用的单条种畜摊销设置详情。',
    effect: 'read',
    inputs: { id: input('种畜摊销设置主键。', '最新列表行的id', { type: 'string | number', constraints: idRules }) },
    output: detailOutput,
    consume: ['把完整详情作为只读核对数据；不要因为GET成功就把后续固定POST /create报告为编辑成功。'],
    steps: [],
    completion: '返回完整详情或明确的null；不代表编辑已经提交。',
    idempotency: null,
  }),

  'finance-setting-livestock-amortization-prepare-create': contract({
    purpose: '复刻页面新建表单的必填、长度、数字范围和Portal数字转换规则，生成创建请求体。',
    effect: 'prepare',
    inputs: {
      generation: input('代次；非空且不超过100个字符。', '页面gen字典选择值', { type: 'string', constraints: ['非空', '最多100个字符'] }),
      breed: input('品种；非空且不超过100个字符。', '页面variety字典选择值', { type: 'string', constraints: ['非空', '最多100个字符'] }),
      line: optional('品系；最多100个字符。', '页面line字典选择值', '发送null', { type: 'string | null', nullable: true }),
      depreciationMethod: optional('计提方法；页面控件禁用且默认字符串1。', '页面表单默认值', '使用字符串1', { type: 'string | number | null' }),
      accrualAgeDays: input('计提种摊日龄；页面必填、最小0、整数。', '页面数字输入框', { type: 'string | number', constraints: ['有限数字', '整数', '最小0'] }),
      accrualAgeCoefficient: input('计提种摊日龄系数；页面必填。', '页面数字输入框或本地公式结果', { type: 'string | number', constraints: ['有限数字'] }),
      accrualMaxDays: input('种摊提取天数；页面必填、最小0、整数。', '页面数字输入框', { type: 'string | number', constraints: ['有限数字', '整数', '最小0'] }),
      netSalvageRate: input('净残值率；页面必填、最小0且不能超过1。', '页面数字输入框', { type: 'string | number', constraints: ['有限数字', '0到1'] }),
      accrualRatio: optional('后端计提比例；当前页面不展示。', '调用方显式扩展字段', '不发送该字段', { type: 'string | number | null', nullable: true }),
      flockStatus: optional('鸡群状态；页面没有必填规则。', '页面chicken_status选择值', '发送null', { type: 'string | number | null', nullable: true }),
      id: optional('显式传入的主键；用于记录编辑路由仍POST /create的源码行为。', '调用方显式输入', '不发送id', { type: 'string | number', constraints: idRules }),
    },
    output: draftOutput,
    consume: ['确认draft后原样提交create；不要把本地公式结果当成服务端已保存。', '当前列表无编辑按钮，不能把带id的draft解释成update草稿。'],
    steps: createSteps,
    completion: '生成未发网络请求的Portal创建草稿。',
    idempotency: null,
  }),

  'finance-setting-livestock-amortization-create': contract({
    purpose: '按页面新建表单提交一条种畜摊销设置。',
    effect: 'write',
    inputs: { draft: input('prepareCreate返回的完整Portal创建草稿。', 'finance-setting-livestock-amortization-prepare-create.result.draft', { type: 'object' }) },
    output: { shape: 'string | number', fields: [field('$', 'string | number', '新建记录主键；不是代次、品种或列表位置', { constraints: idRules })], empty: '后端未返回合法主键时抛错。' },
    consume: ['返回ID后list回查，按代次、品种、品系、鸡群状态和数值字段核对；只看HTTP成功不算完成。', 'Java服务端创建默认status=1，调用方不要把表单里的可选字段当成状态切换。'],
    steps: [{ role: 'required', when: 'create返回ID或请求超时需要确认终态', capabilityId: 'finance-setting-livestock-amortization-list', mapping: {}, instruction: '刷新列表并按返回ID及业务字段核对记录。' }],
    completion: '返回合法ID并完成列表回查；只有回查确认后才能报告已创建。',
    idempotency: '接口没有requestId；超时先list/get按业务字段核对，不要盲目重复创建。',
  }),

  'finance-setting-livestock-amortization-prepare-set-status': contract({
    purpose: '根据最新列表行生成与当前状态相反的绝对启停草稿。',
    effect: 'prepare',
    inputs: {
      current: input('最新列表行的id和status。', 'finance-setting-livestock-amortization-list.result.list[]', { type: 'object' }),
      targetStatus: input('绝对目标状态：0停用或1启用，必须与current.status相反。', '用户确认的启用/停用意图', { type: 'integer', options: statusOptions, constraints: ['不能传toggle', '不能与current.status相同'] }),
    },
    output: statusOutput,
    consume: ['把draft原样交给setStatus；previous仅用于审计/显式恢复，不是自动回滚。'],
    steps: statusSteps,
    completion: '生成未发网络请求的绝对状态草稿。',
    idempotency: null,
  }),

  'finance-setting-livestock-amortization-set-status': contract({
    purpose: '按绝对status启用或停用一条种畜摊销设置，复刻Portal实际PUT请求体。',
    effect: 'write',
    inputs: { draft: input('prepareSetStatus返回的{id,status}草稿。', 'finance-setting-livestock-amortization-prepare-set-status.result.draft', { type: 'object' }) },
    output: { shape: 'true', fields: [field('$', 'boolean', '后端启停成功回执；固定为true')], empty: '非true回执抛错。' },
    consume: ['返回true后list回查同一id的status；不要把发送成功当作状态已落库。', '请求体是{params:{id,status}}，这是Portal源码实际发送形状，不是Axios配置对象。'],
    steps: [{ role: 'required', when: 'setStatus返回true或请求超时需要确认终态', capabilityId: 'finance-setting-livestock-amortization-list', mapping: {}, instruction: '刷新列表核对同一id的最终status。' }],
    completion: '返回true并完成列表回查确认目标状态。',
    idempotency: '没有requestId；同一绝对status重复提交通常不再次切换，但超时必须先回查。',
  }),

  'finance-setting-livestock-amortization-calculate-coefficient': contract({
    purpose: '复刻表单监听净残值率和提取天数时的本地日龄系数公式。',
    effect: 'local',
    inputs: {
      netSalvageRate: optional('净残值率。', '表单netSalvageRate', '返回null', { type: 'string | number | null', nullable: true }),
      accrualMaxDays: optional('种摊提取天数。', '表单accrualMaxDays', '返回null', { type: 'string | number | null', nullable: true }),
    },
    output: coefficientOutput,
    consume: ['把正数结果放入prepareCreate.accrualAgeCoefficient；调用方仍需提交完整表单。', 'null只表示页面本地没有可计算的正系数，不代表后端拒绝或已保存。'],
    steps: [],
    completion: '返回与Portal页面相同的本地计算结果；不发网络请求。',
    idempotency: null,
  }),
}

export const FINANCE_SETTING_LIVESTOCK_AMORTIZATION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_LIVESTOCK_AMORTIZATION_METHODS).map(([id, method]) => [`financeSettingLivestockAmortization.${method}`, FINANCE_SETTING_LIVESTOCK_AMORTIZATION_AI_CONTRACTS[id]!]),
)
