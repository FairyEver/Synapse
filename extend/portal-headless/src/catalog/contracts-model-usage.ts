import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { modelUsageCapabilities } from '../capabilities/model-usage.js'

const definitions = new Map(modelUsageCapabilities.map(definition => [definition.id, definition]))

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const boundaries = [
  '页面路径是/dashboard/model-usage/list，菜单标题是“个人用量”，权限码是/dashboard/model-usage；它属于提示词保留的portal/个人用量范围，不是独立生产模块，也不暴露生产顶级菜单能力。',
  '个人页面固定statisticsDimension=1（个人）；SDK不把它开放成可切换的企业/平台参数。页面根入口不加载全量租户候选，也不调用已经在Portal后端注释掉的ai-token/quota-usage/daily-progress。',
  '页面请求走Portal默认platform实例；当前页面路径没有module-type规则，SDK不发送module-type。会话token、租户和权限由SDK页面上下文注入，调用方不能用个人用量能力越过页面权限读取其他范围。',
  'QuotaTab和UsageTab是共享组件：本能力只覆盖个人根路由的实际可达行为；带modelId的模型上下文参数用于页面从模型入口打开的用量详情，不能据此把平台用量页面或独立生产页面纳入本能力。',
]

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@app/portal/menus/index.js、app/portal/views/dashboard/common/model-usage/list.vue、components/ModelUsageContent.vue、components/QuotaTab.vue、components/UsageTab.vue、components/ApplyFormModal.vue、components/ApplyRecordModal.vue、api.js、utils.js（test/portal/main）',
    kind: 'reference',
    note: '逐页核对个人入口、统计维度固定值、额度/用量默认筛选、申请表单与申请记录权限、导出和本地功能模块筛选行为。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@AiTokenQuotaUsageController、AiTokenUsageController、AiTokenQuotaApplyController、AiTokenCommonController及对应ReqVO/RespVO（test/test）',
    kind: 'reference',
    note: '核对查询权限、申请创建PermitAll、申请记录权限、返回字段、expectedMonthlyQuota的@NotNull @Positive约束和已注释daily-progress映射。',
  },
  {
    source: 'src/capabilities/model-usage.ts、test/model-usage.test.ts、docs/pages/个人用量.md',
    kind: 'implementation',
    note: '锁定页面边界、请求参数、表单校验、导出文件协议和离线反证；未把离线断言当作真实用户权限或写入回查证据。',
  },
]

const gaps = [
  '尚未在真实测试环境用当前用户执行个人用量读取、无权限和跨租户权限矩阵；当前证据是Portal/Java源码与离线请求断言。',
  'Portal表单允许只填expectedMaxToken或填0，但固定Java源码对expectedMonthlyQuota声明@NotNull @Positive；SDK保留页面规则并通过prepare warnings暴露该后端冲突。',
  '申请记录页面的状态选项与固定Java枚举存在0/1/2/3对4的差异；SDK按页面筛选值原样传递，不把筛选值冒充后端处理状态。',
]

function kindType (kind: string): string {
  switch (kind) {
    case 'number': return 'number | string'
    case 'boolean': return 'boolean'
    case 'date': return 'string[]'
    case 'enum': return 'number | string'
    case 'text': return 'string'
    default: return 'string'
  }
}

function inputsFor (id: string, overrides: Record<string, AiParameter> = {}): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Model usage contract has no registered definition: ${id}`)
  const inputs: Record<string, AiParameter> = {}
  for (const item of definition.params) {
    inputs[item.name] = param(
      item.description || `${item.name}，按Portal页面规则传入`,
      'Portal个人用量页面表单或前一能力返回值',
      { type: kindType(item.kind), required: item.required },
    )
  }
  return { ...inputs, ...overrides }
}

function output (shape: string, fields: AiField[], empty: string): AiContract['output'] {
  return { shape, fields, empty }
}

function base (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract {
  return {
    ...value,
    whenToUse: '操作Portal“个人用量”页面的额度、用量、分析、导出或额度提升申请入口。',
    boundaries,
    prerequisites: ['使用当前用户、当前租户的有效Portal会话，并拥有页面权限；需要查询接口时还必须拥有ai-token:usage:query，申请记录还必须拥有ai-token:apply:query。'],
    failures: [
      '会话、租户、页面权限、后端业务错误、网络错误和响应结构错误原样抛出；空列表只表示当前筛选没有数据，不能解释成无权限。',
      '个人维度固定为1；不得把statisticsDimension改成2或3来扩大读取范围。',
    ],
    evidence,
    gaps,
  }
}

const pageFields = [
  field('list', 'object[]', '当前页数据数组；空数组表示当前筛选没有记录'),
  field('list[].id', 'number | string', '记录主键；用于查看额度或用量详情', { optional: true, nullable: true, nullMeaning: '后端未返回主键时不能用该行执行详情操作' }),
  field('total', 'number', '符合筛选条件的总条数；用于分页'),
]

const quotaFields = [
  ...pageFields,
  field('list[].modelId', 'number | string', '模型ID'),
  field('list[].modelName', 'string | null', '模型名称', { nullable: true, nullMeaning: '模型名称未配置或后端未返回' }),
  field('list[].quotaCycle', 'number | null', '额度周期；1日、2周、3月', { optional: true, nullable: true, values: { '1': '日', '2': '周', '3': '月' } }),
  field('list[].cycleQuota', 'number | string | null', '当前周期额度', { optional: true, nullable: true, nullMeaning: '后端未计算该周期额度' }),
  field('list[].usedQuota', 'number | string | null', '已使用额度', { optional: true, nullable: true, nullMeaning: '后端未计算' }),
  field('list[].remainingQuota', 'number | string | null', '剩余额度', { optional: true, nullable: true, nullMeaning: '后端未计算' }),
  field('list[].usageRate', 'number | string | null', '额度使用率', { optional: true, nullable: true, nullMeaning: '未分配额度时可能为空' }),
  field('list[].maxTokenPerRequest', 'number | string | null', '单次最大Token数', { optional: true, nullable: true, nullMeaning: '未配置' }),
  field('list[].usageStatus', 'number | null', '额度使用状态；0未分配、1正常、2预警、3已用尽', { optional: true, nullable: true }),
  field('list[].usageStatusName', 'string | null', '额度使用状态显示名', { optional: true, nullable: true, nullMeaning: '后端未返回显示名' }),
]

const usageRowFields = [
  field('list[].id', 'number | string', '调用明细主键'),
  field('list[].requestId', 'string | null', '调用请求ID', { nullable: true, nullMeaning: '内部记录未关联请求ID' }),
  field('list[].callTime', 'string | null', '调用时间；按服务端原始时间字符串消费', { nullable: true, nullMeaning: '记录未保存调用时间' }),
  field('list[].durationMsStr', 'string | null', '调用耗时的展示字符串', { nullable: true, nullMeaning: '后端未格式化耗时' }),
  field('list[].functionModule', 'string | null', '功能模块名称', { nullable: true, nullMeaning: '未关联功能模块' }),
  field('list[].callStatus', 'number | null', '调用状态值；1成功、2限流、3额度不足、4失败', { nullable: true }),
  field('list[].callStatusName', 'string | null', '调用状态显示名', { nullable: true, nullMeaning: '后端未返回显示名' }),
  field('list[].modelId', 'number | string | null', '模型ID', { nullable: true, nullMeaning: '模型未关联' }),
  field('list[].modelName', 'string | null', '模型名称；页面缺失时可能用模型候选补齐', { nullable: true, nullMeaning: '模型名称未返回且候选中也没有' }),
  field('list[].inputTokens', 'number | string | null', '输入Token数', { nullable: true, nullMeaning: '调用记录未保存' }),
  field('list[].outputTokens', 'number | string | null', '输出Token数', { nullable: true, nullMeaning: '调用记录未保存' }),
  field('list[].totalTokens', 'number | string | null', '输入与输出Token总数', { nullable: true, nullMeaning: '调用记录未保存' }),
  field('list[].consumedQuota', 'number | string | null', '本次扣减额度', { nullable: true, nullMeaning: '本次调用未扣减额度' }),
  field('list[].quotaDeducted', 'boolean | null', '是否扣减额度', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].userName', 'string | null', '调用用户名称', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].tenantName', 'string | null', '租户名称', { nullable: true, nullMeaning: '后端未返回或个人调用无租户展示' }),
  field('list[].limitType', 'string | null', '限制类型；FLOW或QUOTA', { nullable: true, nullMeaning: '本次没有触发限制' }),
  field('list[].failureReason', 'string | null', '失败原因', { nullable: true, nullMeaning: '调用成功或后端未记录原因' }),
  field('total', 'number', '符合筛选条件的总条数'),
]

const usageDetailFields = [
  field('id', 'number | string', '调用明细主键'),
  field('requestId', 'string | null', '调用请求ID', { nullable: true, nullMeaning: '无请求ID' }),
  field('callTime', 'string | null', '调用时间', { nullable: true, nullMeaning: '未记录' }),
  field('durationMsStr', 'string | null', '调用耗时展示值', { nullable: true, nullMeaning: '未格式化' }),
  field('functionModule', 'string | null', '功能模块', { nullable: true, nullMeaning: '未关联' }),
  field('callStatus', 'number | null', '调用状态值', { nullable: true }),
  field('callStatusName', 'string | null', '调用状态显示名', { nullable: true, nullMeaning: '未返回' }),
  field('requestSummary', 'string | null', '请求摘要', { nullable: true, nullMeaning: '未记录摘要' }),
  field('userName', 'string | null', '调用用户', { nullable: true, nullMeaning: '未返回' }),
  field('userBelong', 'number | null', '用户归属值；1个人、2企业', { nullable: true }),
  field('userBelongName', 'string | null', '用户归属显示名', { nullable: true, nullMeaning: '未返回' }),
  field('tenantName', 'string | null', '租户名称', { nullable: true, nullMeaning: '未返回' }),
  field('memberLevel', 'number | null', '会员等级', { nullable: true, nullMeaning: '未返回' }),
  field('memberLevelName', 'string | null', '会员等级显示名', { nullable: true, nullMeaning: '未返回' }),
  field('modelName', 'string | null', '模型名称', { nullable: true, nullMeaning: '未返回' }),
  field('inputTokens', 'number | string | null', '输入Token数', { nullable: true, nullMeaning: '未记录' }),
  field('outputTokens', 'number | string | null', '输出Token数', { nullable: true, nullMeaning: '未记录' }),
  field('totalTokens', 'number | string | null', '总Token数', { nullable: true, nullMeaning: '未记录' }),
  field('consumedQuota', 'number | string | null', '扣减额度', { nullable: true, nullMeaning: '未扣减' }),
  field('quotaDeducted', 'boolean | null', '是否扣减额度', { nullable: true, nullMeaning: '未返回' }),
  field('chargeTargetType', 'number | string | null', '扣费目标类型', { nullable: true, nullMeaning: '未返回' }),
  field('failureReason', 'string | null', '失败原因', { nullable: true, nullMeaning: '没有失败原因' }),
  field('errorCode', 'string | number | null', '错误码', { nullable: true, nullMeaning: '调用成功或无错误码' }),
  field('limitType', 'string | null', '限制类型；FLOW或QUOTA', { nullable: true, nullMeaning: '未触发限制' }),
  field('quotaBefore', 'number | string | null', '调用前个人额度', { nullable: true, nullMeaning: '未返回' }),
  field('quotaAfter', 'number | string | null', '调用后个人额度', { nullable: true, nullMeaning: '未返回' }),
  field('tenantQuotaBefore', 'number | string | null', '调用前租户额度', { nullable: true, nullMeaning: '未返回' }),
  field('tenantQuotaAfter', 'number | string | null', '调用后租户额度', { nullable: true, nullMeaning: '未返回' }),
  field('quotaRuleId', 'number | string | null', '命中的额度规则ID', { nullable: true, nullMeaning: '未命中额度规则' }),
  field('flowRuleId', 'number | string | null', '命中的流速规则ID', { nullable: true, nullMeaning: '未命中流速规则' }),
  field('flowLimited', 'boolean | null', '是否触发流速限制', { nullable: true, nullMeaning: '未返回' }),
  field('tokenLimitPerMinute', 'number | string | null', '每分钟Token上限', { nullable: true, nullMeaning: '未命中流速规则' }),
  field('flowRuleTokenLimit', 'number | string | null', '流速规则Token上限', { nullable: true, nullMeaning: '未返回' }),
]

const contracts: Record<string, AiContract> = {}
function add (id: string, contract: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Model usage contract has no registered definition: ${id}`)
  contracts[id] = contract
}

add('personal-usage-quota-list', base({
  purpose: '读取个人额度Tab的分页列表，展示模型、额度周期、已用/剩余额度和使用状态。',
  effect: 'read',
  inputs: inputsFor('personal-usage-quota-list'),
  output: output('{ list: object[], total: number }', quotaFields, 'list为空表示当前个人额度筛选没有记录；total用于分页。'),
  consume: ['默认quotaCycle=3、pageNo=1、pageSize=20；服务端请求始终带statisticsDimension=1。', '使用list[].modelId作为查看用量入口的模型上下文，不把modelName当模型ID。'],
  steps: [],
  completion: '得到个人额度当前页及分页总数；不代表用户可以申请或修改额度。',
  idempotency: null,
}))

add('personal-usage-quota-summary', base({
  purpose: '读取个人额度Tab顶部的当前周期总额度、已用额度、剩余额度和可用额度汇总。',
  effect: 'read',
  inputs: inputsFor('personal-usage-quota-summary'),
  output: output('object', [field('cycleTotalQuota', 'number | string | null', '当前周期总额度', { nullable: true, nullMeaning: '没有可用额度或后端未返回' }), field('cycleUsedQuota', 'number | string | null', '当前周期已用额度', { nullable: true, nullMeaning: '未返回' }), field('cycleRemainingQuota', 'number | string | null', '当前周期剩余额度', { nullable: true, nullMeaning: '未返回' }), field('currentCycleAvailableQuota', 'number | string | null', '当前周期可用额度', { nullable: true, nullMeaning: '未返回' })], '返回对象缺少字段时按字段缺失处理，不能把缺失解释成0。'),
  consume: ['与额度列表使用同一筛选条件但不发送pageNo/pageSize；默认quotaCycle=3、statisticsDimension=1。'],
  steps: [],
  completion: '得到当前个人额度汇总；不代表额度申请已审批。',
  idempotency: null,
}))

add('personal-usage-usage-list', base({
  purpose: '读取个人用量Tab的分页调用明细，供列表筛选、查看详情和导出前确认。',
  effect: 'read',
  inputs: inputsFor('personal-usage-usage-list', { dateRange: param('自定义日期选择器的开始日和结束日；仅自定义范围有意义。SDK会将10位日期补为00:00:00/23:59:59。', 'Portal UsageTab form.dateRange', { type: 'string[]', required: false, nullable: true }) }),
  output: output('{ list: object[], total: number }', usageRowFields, 'list为空表示当前筛选没有调用明细；total用于分页。'),
  consume: ['根个人页面默认quotaCycle=2、timeRangeType=2、pageNo=1、pageSize=20，并固定statisticsDimension=1。', 'functionModule候选由个人功能模块能力返回后本地筛选；不要为每次输入关键字重新请求。'],
  steps: [],
  completion: '得到个人用量明细页；成功返回不等于每一条调用都成功，需按callStatus消费。',
  idempotency: null,
}))

add('personal-usage-usage-analytics', base({
  purpose: '读取个人用量Tab的汇总、趋势、模型占比和功能模块排行；按页面上下文可只取汇总。',
  effect: 'read',
  inputs: inputsFor('personal-usage-usage-analytics', { dateRange: param('自定义日期选择器的开始日和结束日；SDK按闭区间补齐时分秒。', 'Portal UsageTab form.dateRange', { type: 'string[]', required: false, nullable: true }), includeBreakdowns: param('是否同时请求趋势、模型占比和功能模块排行；根个人页面默认true，从模型上下文进入时传false。', 'Portal ModelUsageContent 的是否存在modelId上下文', { type: 'boolean', required: false, default: 'true' }) }),
  output: output('object', [field('summary', 'object | null', '用量汇总；summary请求失败时为null', { nullable: true, nullMeaning: '对应请求失败，查看errors.summary' }), field('summary.totalConsumedQuota', 'number | string | null', '统计区间总扣减额度', { optional: true, nullable: true }), field('summary.totalCallCount', 'number | null', '统计区间总调用次数', { optional: true, nullable: true }), field('summary.successCallCount', 'number | null', '成功调用次数', { optional: true, nullable: true }), field('summary.limitedCallCount', 'number | null', '限流调用次数', { optional: true, nullable: true }), field('summary.quotaNotEnoughCallCount', 'number | null', '额度不足调用次数', { optional: true, nullable: true }), field('summary.failedCallCount', 'number | null', '失败调用次数', { optional: true, nullable: true }), field('trend', 'object[] | null', '按日期的额度/调用次数趋势；不取分解或请求失败时为null', { nullable: true }), field('trend[].date', 'string', '趋势日期', { optional: true }), field('trend[].consumedQuota', 'number | string | null', '当日扣减额度', { optional: true, nullable: true }), field('trend[].callCount', 'number | null', '当日调用次数', { optional: true, nullable: true }), field('modelRatio', 'object[] | null', '按模型聚合的用量占比；不取分解或请求失败时为null', { nullable: true }), field('modelRatio[].modelId', 'number | string | null', '模型ID', { optional: true, nullable: true }), field('modelRatio[].modelName', 'string | null', '模型名称', { optional: true, nullable: true }), field('modelRatio[].consumedQuota', 'number | string | null', '模型扣减额度', { optional: true, nullable: true }), field('moduleRanking', 'object[] | null', '按功能模块聚合的排行；不取分解或请求失败时为null', { nullable: true }), field('moduleRanking[].functionModule', 'string | null', '功能模块', { optional: true, nullable: true }), field('moduleRanking[].consumedQuota', 'number | string | null', '模块扣减额度', { optional: true, nullable: true }), field('moduleRanking[].callCount', 'number | null', '模块调用次数', { optional: true, nullable: true }), field('errors', 'object', '各独立请求的错误字典；没有错误时为空对象'), field('errors.*', 'string', '以summary/trend/modelRatio/moduleRanking为键的错误消息')], '所有请求失败时相应数据项为null且errors记录原因；不把失败伪装为空数组。'),
  consume: ['根个人页面无modelId时默认四路并发；从模型上下文进入时传includeBreakdowns=false，页面只请求summary。', '分析结果是统计快照，不能代替用量明细或审批状态。'],
  steps: [],
  completion: '获得已明确标注失败项的个人用量分析结果。',
  idempotency: null,
}))

add('personal-usage-usage-detail', base({
  purpose: '读取单条个人用量调用详情，供UsageDetailModal展示请求、Token、扣费和限流信息。',
  effect: 'read',
  inputs: inputsFor('personal-usage-usage-detail', { id: param('用量记录主键；不能传模型ID。', 'personal-usage-usage-list.result.list[].id或用户选择的详情行', { type: 'number | string', required: true }) }),
  output: output('object', usageDetailFields, '响应不是对象或缺少可识别明细时抛错；不要用列表行猜详情字段。'),
  consume: ['先用listUsage找到id，再用detail中的callStatus/callStatusName判断调用结果。', 'quotaRuleId、flowRuleId、quotaBefore/After等可能为空；空值表示该规则/快照没有记录，不是0。'],
  steps: [],
  completion: '得到选定调用明细的完整可展示字段。',
  idempotency: null,
}))

add('personal-usage-usage-export', base({
  purpose: '按个人用量筛选条件导出全部匹配的调用明细文件。',
  effect: 'read',
  inputs: inputsFor('personal-usage-usage-export', { dateRange: param('自定义日期范围；10位日期补为闭区间时分秒。', 'Portal UsageTab form.dateRange', { type: 'string[]', required: false, nullable: true }) }),
  output: output('object', [field('fileName', 'string', '下载文件名；优先使用content-disposition，否则为模型用量明细.xls'), field('contentType', 'string | null', '响应Content-Type', { nullable: true, nullMeaning: '服务器未返回Content-Type' }), field('base64', 'string', '文件二进制内容的标准Base64'), field('byteLength', 'number', '文件字节数')], '空文件或非二进制响应抛错；不要把空Base64当导出成功。'),
  consume: ['导出请求与用量列表共享筛选字段但不发送pageNo/pageSize；固定statisticsDimension=1。', '将base64还原为文件保存；成功下载不代表筛选结果一定非空，仍应核对byteLength。'],
  steps: [],
  completion: '得到可保存的个人用量明细文件。',
  idempotency: null,
}))

add('personal-usage-function-module-list', base({
  purpose: '取得个人用量功能模块候选，供UsageTab的功能模块筛选。',
  effect: 'read',
  inputs: inputsFor('personal-usage-function-module-list'),
  output: output('string[]', [field('[]', 'string', '功能模块名称；SDK按keyword在本地过滤')], '没有候选时返回空数组；该接口不接受服务端关键字参数。'),
  consume: ['页面挂载时请求一次，keyword只改变返回的本地过滤结果；不要把本地过滤误认为后端筛选。'],
  steps: [],
  completion: '得到可用于功能模块筛选的候选名称。',
  idempotency: null,
}))

add('personal-usage-model-detail', base({
  purpose: '读取从模型入口打开个人用量明细时的模型上下文，用于弹窗标题和模型信息展示。',
  effect: 'read',
  inputs: inputsFor('personal-usage-model-detail', { id: param('模型主键；不能传用量记录ID。', 'Portal路由query.modelId', { type: 'number | string', required: true }) }),
  output: output('object', [field('id', 'number | string', '模型ID'), field('modelName', 'string | null', '模型名称', { nullable: true, nullMeaning: '未配置' }), field('availableStatus', 'number | null', '模型可用状态', { nullable: true }), field('supportedFiles', 'string | null', '支持文件类型串', { nullable: true, nullMeaning: '未配置' }), field('description', 'string | null', '模型描述', { nullable: true, nullMeaning: '未填写' })], '模型不存在或响应缺少id时抛错；不能带着空模型上下文继续。'),
  consume: ['仅在路由带modelId的上下文使用；此请求不改变模型配置。'],
  steps: [],
  completion: '得到用于个人用量上下文展示的模型详情。',
  idempotency: null,
}))

const applyPayloadFields = [
  field('modelId', 'number | string', '申请模型ID'),
  field('currentMonthlyQuota', 'number | string | null', '当前月度额度快照', { optional: true, nullable: true, nullMeaning: '表单未拿到当前额度' }),
  field('expectedMonthlyQuota', 'number | string | null', '期望月度额度；Portal允许为空/0，但固定Java服务要求@NotNull @Positive', { optional: true, nullable: true, nullMeaning: '只申请单次最大Token时可能为空' }),
  field('currentMaxToken', 'number | string | null', '当前单次最大Token快照', { optional: true, nullable: true, nullMeaning: '表单未拿到当前值' }),
  field('expectedMaxToken', 'number | string | null', '期望单次最大Token', { optional: true, nullable: true, nullMeaning: '只申请月度额度时可能为空' }),
  field('statisticsDimension', 'number', '固定为1个人维度'),
  field('reason', 'string', '申请原因；Portal要求非空，最多200字符'),
]

add('personal-usage-apply-prepare', base({
  purpose: '按Portal额度提升申请弹窗规则校验草稿，并生成将要提交的请求体。',
  effect: 'prepare',
  inputs: inputsFor('personal-usage-apply-prepare', { draft: param('申请草稿；至少填写expectedMonthlyQuota或expectedMaxToken之一，reason非空且不超过200字符。', '用户在ApplyFormModal中的明确输入', { type: 'object', required: true }) }),
  output: output('{ draft: object, payload: object, warnings: string[] }', [...applyPayloadFields.map(item => ({ ...item, path: `payload.${item.path}` })), field('draft', 'object', '原始申请草稿'), field('payload', 'object', '按Portal字段映射且固定statisticsDimension=1的提交体'), field('warnings[]', 'string', '已知Portal表单与固定Java校验不一致的提醒；非空时不能宣称后端必然接受')], '本地校验失败直接抛错且不发网络请求。'),
  consume: ['把payload保存为submitApply的draft来源；不要把modelName发送给后端，页面buildApplyPayload也不会发送它。', 'Portal前端规则是两个期望字段至少一个有值、数值为非负整数、reason必填且最多200字符；SDK不把后端更严格的expectedMonthlyQuota正数约束静默塞进页面校验。'],
  steps: [{ role: 'required', when: '用户确认申请且已处理warnings', capabilityId: 'personal-usage-apply-submit', mapping: { draft: 'result.draft' }, instruction: '只把同一次prepare返回的draft交给submit；不要手工修改payload后绕过表单规则。' }, { role: 'cancel', when: '用户关闭申请弹窗或取消', capabilityId: 'personal-usage-apply-cancel', instruction: '丢弃本地draft和payload；取消不调用后端撤销接口，因为Portal没有申请草稿取消端点。' }],
  completion: '得到可审阅的申请payload；prepare本身不创建申请记录。',
  idempotency: null,
}))

add('personal-usage-apply-submit', base({
  purpose: '提交一个已通过Portal个人额度申请规则校验的额度提升申请。',
  effect: 'write',
  inputs: inputsFor('personal-usage-apply-submit', { draft: param('同一次prepare返回的申请草稿；submit会重新执行相同本地校验。', 'personal-usage-apply-prepare.result.draft', { type: 'object', required: true }) }),
  output: output('number | string', [field('$', 'number | string', '新建额度申请记录ID；表示申请已受理，不表示已经审批通过')], '响应不是申请ID时抛错；HTTP成功或true不能当作已创建。'),
  consume: ['请求为POST /admin-api/ai-token/apply/create，body包含modelId、当前/期望额度、当前/期望Token、statisticsDimension=1和reason。', '后端create使用PermitAll但仍要求有效会话；页面的申请记录列表另受ai-token:apply:query权限控制。'],
  steps: [{ role: 'recovery', when: '提交响应超时、返回不明确或用户要求确认', capabilityId: 'personal-usage-apply-record-list', instruction: '先按模型/日期/状态回查申请记录，再决定是否重试；未确认前不要盲目重复创建。' }, { role: 'cancel', when: '用户在提交前取消', capabilityId: 'personal-usage-apply-cancel', instruction: '提交前仅丢弃草稿；提交成功后页面没有服务端取消能力，不能伪造撤回。' }],
  completion: '仅当获得申请ID或申请记录回查确认新记录存在，才能报告申请已受理；审批结果需要后续申请记录/管理流程确认。',
  idempotency: '后端创建接口没有requestId幂等协议；响应超时先用personal-usage-apply-record-list按模型和申请时间回查，未确认前不重发，避免重复申请。',
}))

add('personal-usage-apply-record-list', base({
  purpose: '读取个人额度提升申请记录弹窗中的分页列表。',
  effect: 'read',
  inputs: inputsFor('personal-usage-apply-record-list'),
  output: output('{ list: object[], total: number }', [...pageFields, field('list[].modelName', 'string | null', '申请模型名称', { nullable: true, nullMeaning: '后端未返回' }), field('list[].statisticsDimension', 'number | null', '申请统计维度；个人申请应为1', { nullable: true }), field('list[].currentMonthlyQuota', 'number | string | null', '申请时当前月度额度', { nullable: true, nullMeaning: '未记录' }), field('list[].expectedMonthlyQuota', 'number | string | null', '申请期望月度额度', { nullable: true, nullMeaning: '只申请Token或后端未记录' }), field('list[].currentMaxToken', 'number | string | null', '申请时当前最大Token', { nullable: true, nullMeaning: '未记录' }), field('list[].expectedMaxToken', 'number | string | null', '申请期望最大Token', { nullable: true, nullMeaning: '只申请额度或后端未记录' }), field('list[].reason', 'string | null', '申请原因', { nullable: true, nullMeaning: '后端未返回' }), field('list[].status', 'number | null', '申请状态原值；按返回值消费，不用页面标签反推审批结论', { nullable: true }), field('list[].statusName', 'string | null', '申请状态显示名', { nullable: true, nullMeaning: '后端未返回' }), field('list[].createTime', 'string | null', '申请时间', { nullable: true, nullMeaning: '后端未返回' })], '无申请记录时返回空list；没有ai-token:apply:query权限时应抛权限错误而非返回空列表。'),
  consume: ['该能力对应ApplyRecordModal，需要ai-token:apply:query按钮权限；默认pageNo=1、pageSize=20、statisticsDimension=1。', 'dateRange按共享页面utils原样传startDate/endDate日期字符串，不补00:00:00/23:59:59；固定Java页查询的DateTimeFormat差异见gaps。'],
  steps: [],
  completion: '得到可核对的个人申请记录分页；状态是记录状态，不等于当前额度已变更。',
  idempotency: null,
}))

add('personal-usage-apply-cancel', base({
  purpose: '取消个人额度申请弹窗中的未提交草稿。',
  effect: 'local',
  inputs: inputsFor('personal-usage-apply-cancel'),
  output: output('{ cancelled: boolean }', [field('cancelled', 'boolean', '固定为true，表示本地草稿已丢弃')], '只返回本地取消结果，不触发后端申请删除。'),
  consume: ['调用方应释放prepare返回的draft和payload；如果submit已经成功，不能用此能力声称服务端申请已撤销。'],
  steps: [],
  completion: '本地未提交草稿已丢弃。',
  idempotency: null,
}))

export const MODEL_USAGE_CONTRACTS: Record<string, AiContract> = contracts

export const MODEL_USAGE_METHODS = {
  'personal-usage-quota-list': 'listQuota',
  'personal-usage-quota-summary': 'getQuotaSummary',
  'personal-usage-usage-list': 'listUsage',
  'personal-usage-usage-analytics': 'usageAnalytics',
  'personal-usage-usage-detail': 'getUsageDetail',
  'personal-usage-usage-export': 'exportUsage',
  'personal-usage-function-module-list': 'listFunctionModules',
  'personal-usage-model-detail': 'getModelDetail',
  'personal-usage-apply-prepare': 'prepareApply',
  'personal-usage-apply-submit': 'submitApply',
  'personal-usage-apply-record-list': 'listApplyRecords',
  'personal-usage-apply-cancel': 'cancelApply',
} as const

export const MODEL_USAGE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(MODEL_USAGE_METHODS).map(([id, method]) => [
    `modelUsage.${method}`,
    {
      ...MODEL_USAGE_CONTRACTS[id]!,
      boundaries: [...MODEL_USAGE_CONTRACTS[id]!.boundaries, `直接方法使用sdk.modelUsage.${method}；复杂申请仍须遵守同一份prepare→submit→cancel说明。`],
    },
  ]),
)
