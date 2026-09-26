import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  SETTING_ENTERPRISE_USAGE_METHODS,
  settingEnterpriseUsageCapabilities,
} from '../capabilities/setting-enterprise-usage.js'

const definitions = new Map(settingEnterpriseUsageCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const boundaries = [
  '页面路径是/dashboard/setting/enterprise-usage/list，菜单标题是“企业用量”，页面权限码是/dashboard/setting/enterprise-usage；它是系统设置下的公共企业用量页面，不是平台用量页，也不是独立生产菜单能力。',
  'Portal共享ModelUsageContent，但本页面固定statisticsDimension=2（企业）；SDK不接受调用方传入其它统计维度。企业额度/用量数据仍受当前会话用户、当前租户和后端数据权限约束。',
  '页面请求走platform HTTP实例；本页面在module-type规则中没有匹配项，SDK与Portal一样不发送module-type。页面没有企业名称下拉或租户全量候选请求，不能把平台用量的tenantId筛选移植进来。',
  '页面根入口可达额度Tab、用量Tab、企业用量明细筛选、详情、导出、额度提升和申请记录；/ai-token/quota-usage/daily-progress在共享API中但Java映射已注释且页面不消费，因此不登记为本页能力。',
]

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@app/portal/menus/common.js、app/portal/views/dashboard/common/setting/enterprise-usage/list.vue、app/portal/views/dashboard/common/model-usage/components/ModelUsageContent.vue、QuotaTab.vue、UsageTab.vue、UsageDetailModal.vue、ApplyFormModal.vue、ApplyRecordModal.vue、api.js、utils.js @ acab69acc7 (test/portal/main)',
    kind: 'reference',
    note: '逐页核对企业入口、固定统计维度、共享组件的可达Tab/筛选/详情/导出/申请动作、按钮权限和请求参数构造。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@AiTokenQuotaUsageController、AiTokenUsageController、AiTokenQuotaApplyController及AiToken*ReqVO/RespVO/DO @ 0f1a55718eb (test/test)',
    kind: 'reference',
    note: '核对额度/用量各端点的ai-token:usage:query权限、申请记录的ai-token:apply:query权限、申请创建PermitAll、statisticsDimension必填、返回字段和Java校验。',
  },
  {
    source: 'src/capabilities/setting-enterprise-usage.ts、test/setting-enterprise-usage.test.ts、docs/pages/企业用量.md',
    kind: 'implementation',
    note: '锁定SDK请求参数、企业维度、导出二进制处理、申请表单校验、离线反证和证据边界；不把离线请求替代真实环境权限矩阵或写入回查。',
  },
]

const gaps = [
  '尚未在真实测试环境用当前用户执行企业用量读请求、无权限/跨租户矩阵或浏览器逐字段基准；当前结论来自固定Portal/Java源码和离线请求夹具。',
  'Portal申请表单允许只填expectedMaxToken或填0，但固定Java AiTokenQuotaApplySaveReqVO对expectedMonthlyQuota声明@NotNull @Positive；SDK保留页面规则，并由prepare warnings暴露后端可能拒绝的差异。',
  'Portal申请记录筛选提供0/1/2/3四个值，而固定Java AiTokenQuotaApplyStatusEnum声明0/3/4；SDK按页面原样发送，不把页面标签当成已核实的后端状态语义。',
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
  if (!definition) throw new Error(`企业用量契约没有对应能力定义：${id}`)
  const inputs: Record<string, AiParameter> = {}
  for (const item of definition.params) {
    inputs[item.name] = param(
      item.description || `${item.name}，按Portal企业用量页面规则传入`,
      'Portal企业用量页面表单或前一能力返回值',
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
    whenToUse: '操作Portal“企业用量”页面的额度、企业用量明细、分析、导出或额度提升申请入口。',
    boundaries,
    prerequisites: ['使用当前用户、当前租户的有效Portal会话；查询/明细/导出接口还需要ai-token:usage:query，申请记录需要ai-token:apply:query。'],
    failures: [
      '会话、租户、页面/按钮权限、后端业务错误、网络错误和响应结构错误原样抛出；空列表只表示当前筛选没有数据，不能解释成无权限。',
      'statisticsDimension由能力固定为2；调用方不能通过输入改成个人或平台维度来扩大/改变数据范围。',
    ],
    evidence,
    gaps,
  }
}

const pageFields = [
  field('list', 'object[]', '当前页记录数组；空数组表示当前筛选没有记录'),
  field('total', 'number', '符合筛选条件的总条数；用于分页，不等于当前页长度'),
]

const quotaFields = [
  ...pageFields,
  field('list[].modelId', 'number | string | null', '模型ID；来自Java Long，传给查看用量或额度申请时使用', { nullable: true, nullMeaning: '后端未关联模型，不能据此发起模型动作' }),
  field('list[].modelName', 'string | null', '模型名称', { nullable: true, nullMeaning: '模型名称未配置或后端未返回' }),
  field('list[].tenantName', 'string | null', '企业名称；企业维度通常由当前租户上下文确定，后端未必返回', { nullable: true, nullMeaning: '该维度响应未返回企业名称' }),
  field('list[].quotaCycle', 'integer | null', '额度周期；1日、2周、3月', { nullable: true, values: { '1': '日', '2': '周', '3': '月' } }),
  field('list[].cycleQuota', 'number | string | null', '当前周期总额度原值；页面按Token数量展示，不换算单位', { nullable: true, nullMeaning: '后端未计算该周期额度' }),
  field('list[].monthlyQuota', 'number | string | null', '月额度原值；申请弹窗作为当前月额度快照', { nullable: true, nullMeaning: '后端未返回月额度' }),
  field('list[].weeklyQuota', 'number | string | null', '周额度原值', { nullable: true, nullMeaning: '后端未返回周额度' }),
  field('list[].dailyQuota', 'number | string | null', '日额度原值', { nullable: true, nullMeaning: '后端未返回日额度' }),
  field('list[].usedQuota', 'number | string | null', '当前周期已用额度原值', { nullable: true, nullMeaning: '后端未计算' }),
  field('list[].remainingQuota', 'number | string | null', '当前周期剩余额度原值', { nullable: true, nullMeaning: '后端未计算' }),
  field('list[].usageRate', 'number | string | null', '额度使用率百分比原值；Portal按百分比展示，不再乘100', { nullable: true, nullMeaning: '未分配额度或后端未返回' }),
  field('list[].maxTokenPerRequest', 'number | string | null', '单次最大Token数原值；申请弹窗作为当前快照', { nullable: true, nullMeaning: '未配置' }),
  field('list[].resetTime', 'string | null', '额度重置时间原值；SDK不做时区转换', { nullable: true, nullMeaning: '后端未返回重置时间' }),
  field('list[].usageStatus', 'integer | null', '额度使用状态；0未分配、1正常、2预警、3已用尽', { nullable: true, values: { '0': '未分配', '1': '正常', '2': '预警', '3': '已用尽' } }),
  field('list[].usageStatusName', 'string | null', '额度使用状态显示名', { nullable: true, nullMeaning: '后端未返回显示名' }),
]

const usageRowFields = [
  ...pageFields,
  field('list[].id', 'number | string', '用量记录主键；查看详情必须使用该ID，不能用modelId替代'),
  field('list[].modelId', 'number | string | null', '模型ID', { nullable: true, nullMeaning: '调用未关联模型' }),
  field('list[].modelName', 'string | null', '模型名称', { nullable: true, nullMeaning: '后端未返回或页面候选无法补齐' }),
  field('list[].requestId', 'string | null', '调用请求编号', { nullable: true, nullMeaning: '记录未关联请求编号' }),
  field('list[].callTime', 'string | null', '调用时间原值', { nullable: true, nullMeaning: '记录未保存调用时间' }),
  field('list[].durationMsStr', 'string | null', '调用耗时展示字符串；页面原样展示', { nullable: true, nullMeaning: '后端未格式化耗时' }),
  field('list[].tenantName', 'string | null', '所属企业名称', { nullable: true, nullMeaning: '后端未返回企业名称' }),
  field('list[].userName', 'string | null', '用户名称', { nullable: true, nullMeaning: '后端未返回用户名称' }),
  field('list[].userBelongName', 'string | null', '用户归属显示名；可由userBelong字典值补充', { nullable: true, nullMeaning: '后端未返回显示名' }),
  field('list[].memberLevelName', 'string | null', '会员等级显示名；可由memberLevel字典值补充', { nullable: true, nullMeaning: '后端未返回显示名' }),
  field('list[].userBelong', 'integer | null', '用户归属值；1个人用户、2企业用户', { nullable: true, values: { '1': '个人用户', '2': '企业用户' } }),
  field('list[].memberLevel', 'integer | null', '会员等级；1个人用户、2企业用户-免费、3初级、4中级、5高级', { nullable: true, values: { '1': '个人用户', '2': '企业用户-免费', '3': '企业用户-初级', '4': '企业用户-中级', '5': '企业用户-高级' } }),
  field('list[].functionModule', 'string | null', '功能模块名称', { nullable: true, nullMeaning: '未关联功能模块' }),
  field('list[].inputTokens', 'number | string | null', '输入Token数原值', { nullable: true, nullMeaning: '调用记录未保存' }),
  field('list[].outputTokens', 'number | string | null', '输出Token数原值', { nullable: true, nullMeaning: '调用记录未保存' }),
  field('list[].totalTokens', 'number | string | null', '输入与输出Token总数原值', { nullable: true, nullMeaning: '调用记录未保存' }),
  field('list[].consumedQuota', 'number | string | null', '本次消耗额度原值', { nullable: true, nullMeaning: '未扣减或后端未返回' }),
  field('list[].userRemainingQuota', 'number | string | null', '用户剩余额度原值', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].tenantRemainingQuota', 'number | string | null', '企业剩余额度原值', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].maxTokenLimit', 'number | string | null', '单次最大Token限制原值', { nullable: true, nullMeaning: '未命中规则或后端未返回' }),
  field('list[].tokenLimitPerMinute', 'number | string | null', '每分钟Token上限原值', { nullable: true, nullMeaning: '未命中流速规则' }),
  field('list[].windowUsedTokens', 'number | string | null', '当前流速窗口已用Token原值', { nullable: true, nullMeaning: '未命中流速规则' }),
  field('list[].callStatus', 'integer | null', '调用状态；1成功、2限流、3额度不足、4失败', { nullable: true, values: { '1': '成功', '2': '限流', '3': '额度不足', '4': '失败' } }),
  field('list[].callStatusName', 'string | null', '调用状态显示名', { nullable: true, nullMeaning: '后端未返回显示名' }),
  field('list[].limitType', 'string | null', '限制类型；页面按原值展示，常见FLOW/QUOTA', { nullable: true, nullMeaning: '未触发限制' }),
  field('list[].quotaDeducted', 'boolean | null', '是否扣减额度', { nullable: true, nullMeaning: '后端未返回' }),
]

const usageDetailFields = [
  field('id', 'number | string | null', '用量记录主键', { nullable: true, nullMeaning: '后端未返回主键' }),
  field('requestId', 'string | null', '请求编号', { nullable: true, nullMeaning: '无请求编号' }),
  field('callTime', 'string | null', '调用时间原值', { nullable: true, nullMeaning: '未记录' }),
  field('durationMsStr', 'string | null', '调用耗时展示字符串', { nullable: true, nullMeaning: '未格式化' }),
  field('functionModule', 'string | null', '功能模块名称', { nullable: true, nullMeaning: '未关联' }),
  field('callStatus', 'integer | null', '调用状态；1成功、2限流、3额度不足、4失败', { nullable: true }),
  field('callStatusName', 'string | null', '调用状态显示名', { nullable: true, nullMeaning: '未返回' }),
  field('requestSummary', 'string | null', '请求内容摘要；页面原样展示', { nullable: true, nullMeaning: '未保存摘要' }),
  field('userName', 'string | null', '用户名称', { nullable: true, nullMeaning: '未返回' }),
  field('userBelong', 'integer | null', '用户归属值；1个人用户、2企业用户', { nullable: true }),
  field('userBelongName', 'string | null', '用户归属显示名', { nullable: true, nullMeaning: '未返回' }),
  field('tenantName', 'string | null', '所属企业名称', { nullable: true, nullMeaning: '未返回' }),
  field('memberLevel', 'integer | null', '会员等级1至5', { nullable: true }),
  field('memberLevelName', 'string | null', '会员等级显示名', { nullable: true, nullMeaning: '未返回' }),
  field('modelId', 'number | string | null', '模型ID', { nullable: true, nullMeaning: '未关联模型' }),
  field('modelName', 'string | null', '模型名称', { nullable: true, nullMeaning: '未返回' }),
  field('inputTokens', 'number | string | null', '输入Token数原值', { nullable: true, nullMeaning: '未保存' }),
  field('outputTokens', 'number | string | null', '输出Token数原值', { nullable: true, nullMeaning: '未保存' }),
  field('totalTokens', 'number | string | null', 'Token总数原值', { nullable: true, nullMeaning: '未保存' }),
  field('consumedQuota', 'number | string | null', '消耗额度原值', { nullable: true, nullMeaning: '未扣减或未返回' }),
  field('quotaDeducted', 'boolean | null', '是否扣减额度', { nullable: true, nullMeaning: '未返回' }),
  field('chargeTargetType', 'integer | null', '实际扣减对象；1个人、2租户；仅在quotaDeducted为真时有业务意义', { nullable: true, values: { '1': '个人', '2': '租户' } }),
  field('quotaRuleId', 'number | string | null', '命中的额度规则ID', { nullable: true, nullMeaning: '未命中额度规则或非审计上下文' }),
  field('baseQuotaTotal', 'number | string | null', '调用时基础通用周期额度快照', { nullable: true, nullMeaning: '未返回' }),
  field('quotaRuleTotalQuota', 'number | string | null', '调用时命中额度规则的总额度快照', { nullable: true, nullMeaning: '未命中或未返回' }),
  field('baseMaxToken', 'number | string | null', '调用时基础单次最大Token快照', { nullable: true, nullMeaning: '未返回' }),
  field('maxTokenLimit', 'number | string | null', '调用时最大单次Token限制', { nullable: true, nullMeaning: '未命中或未返回' }),
  field('quotaBefore', 'number | string | null', '用户扣减前额度快照', { nullable: true, nullMeaning: '未发生用户额度扣减或未返回' }),
  field('quotaAfter', 'number | string | null', '用户扣减后额度快照', { nullable: true, nullMeaning: '未发生用户额度扣减或未返回' }),
  field('tenantQuotaBefore', 'number | string | null', '企业扣减前额度快照', { nullable: true, nullMeaning: '未发生企业额度扣减或未返回' }),
  field('tenantQuotaAfter', 'number | string | null', '企业扣减后额度快照', { nullable: true, nullMeaning: '未发生企业额度扣减或未返回' }),
  field('flowRuleId', 'number | string | null', '命中的流速规则ID', { nullable: true, nullMeaning: '未命中流速规则' }),
  field('tokenLimitPerMinute', 'number | string | null', '命中流速规则的每分钟Token上限', { nullable: true, nullMeaning: '未命中流速规则' }),
  field('flowRuleTokenLimit', 'number | string | null', '流速规则窗口Token上限', { nullable: true, nullMeaning: '未命中或未返回' }),
  field('windowUsedTokens', 'number | string | null', '当前窗口已用Token', { nullable: true, nullMeaning: '未命中流速规则' }),
  field('flowLimited', 'string | boolean | null', '是否触发限流的显示值/原始值', { nullable: true, nullMeaning: '未返回' }),
  field('limitType', 'string | null', '限制类型原值', { nullable: true, nullMeaning: '未触发限制' }),
  field('failureReason', 'string | null', '失败原因', { nullable: true, nullMeaning: '没有失败原因或调用成功' }),
  field('errorCode', 'string | null', '错误码', { nullable: true, nullMeaning: '没有错误码' }),
]

const analysisFields = [
  field('summary', 'object | null', '用量汇总；对应请求失败时为null并查看errors.summary', { nullable: true, nullMeaning: '对应统计请求失败' }),
  field('summary.statisticsRange', 'string | null', '统计范围显示文本', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
  field('summary.totalCallCount', 'number | string | null', '统计区间总调用次数', { optional: true, nullable: true }),
  field('summary.successCallCount', 'number | string | null', '成功调用次数', { optional: true, nullable: true }),
  field('summary.limitedCallCount', 'number | string | null', '限流调用次数', { optional: true, nullable: true }),
  field('summary.quotaNotEnoughCallCount', 'number | string | null', '额度不足调用次数', { optional: true, nullable: true }),
  field('summary.failedCallCount', 'number | string | null', '失败调用次数', { optional: true, nullable: true }),
  field('summary.inputTokens', 'number | string | null', '输入Token总数', { optional: true, nullable: true }),
  field('summary.outputTokens', 'number | string | null', '输出Token总数', { optional: true, nullable: true }),
  field('summary.totalTokens', 'number | string | null', 'Token总数', { optional: true, nullable: true }),
  field('summary.totalConsumedQuota', 'number | string | null', '消耗额度总数', { optional: true, nullable: true }),
  field('summary.currentCycleQuota', 'number | string | null', '当前周期额度', { optional: true, nullable: true }),
  field('summary.currentCycleUsedQuota', 'number | string | null', '当前周期已消耗额度', { optional: true, nullable: true }),
  field('summary.currentCycleRemainingQuota', 'number | string | null', '当前周期剩余额度', { optional: true, nullable: true }),
  field('trend', 'object[] | null', '按日期返回的额度/调用次数/Token趋势；请求失败时为null', { nullable: true, nullMeaning: '对应请求失败或未请求' }),
  field('trend[].date', 'string | null', '趋势日期', { optional: true, nullable: true }),
  field('trend[].consumedQuota', 'number | string | null', '该日期消耗额度', { optional: true, nullable: true }),
  field('trend[].callCount', 'number | string | null', '该日期调用次数', { optional: true, nullable: true }),
  field('trend[].totalTokens', 'number | string | null', '该日期Token总数', { optional: true, nullable: true }),
  field('modelRatio', 'object[] | null', '按模型聚合的消耗占比数据；请求失败时为null', { nullable: true, nullMeaning: '对应请求失败或未请求' }),
  field('modelRatio[].modelId', 'number | string | null', '模型ID', { optional: true, nullable: true }),
  field('modelRatio[].modelName', 'string | null', '模型名称', { optional: true, nullable: true }),
  field('modelRatio[].consumedQuota', 'number | string | null', '模型消耗额度', { optional: true, nullable: true }),
  field('modelRatio[].callCount', 'number | string | null', '模型调用次数', { optional: true, nullable: true }),
  field('modelRatio[].totalTokens', 'number | string | null', '模型Token总数', { optional: true, nullable: true }),
  field('moduleRanking', 'object[] | null', '按功能模块聚合的排行；请求失败时为null', { nullable: true, nullMeaning: '对应请求失败或未请求' }),
  field('moduleRanking[].functionModule', 'string | null', '功能模块名称', { optional: true, nullable: true }),
  field('moduleRanking[].consumedQuota', 'number | string | null', '功能模块消耗额度', { optional: true, nullable: true }),
  field('moduleRanking[].callCount', 'number | string | null', '功能模块调用次数', { optional: true, nullable: true }),
  field('moduleRanking[].totalTokens', 'number | string | null', '功能模块Token总数', { optional: true, nullable: true }),
  field('errors', 'object', '各独立统计请求的错误字典；没有错误时为空对象'),
  field('errors.*', 'string', '以summary/trend/modelRatio/moduleRanking为键的错误消息'),
]

const applyPayloadFields = [
  field('payload.modelId', 'number | string', '申请模型ID；来自同一企业额度列表行'),
  field('payload.currentMonthlyQuota', 'number | string | null', '申请时当前月额度快照', { optional: true, nullable: true, nullMeaning: '表单未拿到当前月额度' }),
  field('payload.expectedMonthlyQuota', 'number | string | null', '期望月额度；Portal允许为空/0，但固定Java服务要求@NotNull @Positive', { optional: true, nullable: true, nullMeaning: '只申请最大Token时可能为空' }),
  field('payload.currentMaxToken', 'number | string | null', '申请时当前单次最大Token快照', { optional: true, nullable: true, nullMeaning: '表单未拿到当前值' }),
  field('payload.expectedMaxToken', 'number | string | null', '期望单次最大Token', { optional: true, nullable: true, nullMeaning: '只申请月额度时可能为空' }),
  field('payload.statisticsDimension', 'integer', '固定为2企业维度', { values: { '2': '企业' } }),
  field('payload.reason', 'string', '申请原因；Portal要求非空且最多200字符'),
]

const contracts: Record<string, AiContract> = {}
function add (id: string, contract: AiContract): void {
  if (!definitions.has(id)) throw new Error(`企业用量契约没有对应能力定义：${id}`)
  contracts[id] = contract
}

add('setting-enterprise-usage-quota-list', base({
  purpose: '读取企业用量页面额度Tab的分页列表，展示当前租户内模型的额度周期、额度消耗、使用率和状态。',
  effect: 'read',
  inputs: inputsFor('setting-enterprise-usage-quota-list'),
  output: output('{ list: object[], total: number }', quotaFields, 'list=[]且total=0表示当前企业额度筛选没有记录；权限、网络或响应错误不会伪装为空页。'),
  consume: [
    '默认quotaCycle=3、pageNo=1、pageSize=20；请求固定带statisticsDimension=2。',
    '使用list[].modelId作为查看该模型企业用量或打开额度申请的来源；不能把modelName当ID。企业页面的userName是当前租户内模糊筛选，不是跨租户查询。',
  ],
  steps: [],
  completion: '得到当前租户企业维度额度当前页及分页总数；这只代表读取到额度快照，不代表额度申请已审批。',
  idempotency: null,
}))

add('setting-enterprise-usage-quota-summary', base({
  purpose: '读取企业额度Tab顶部的周期总额度、已用额度、剩余额度和可用额度汇总。',
  effect: 'read',
  inputs: inputsFor('setting-enterprise-usage-quota-summary'),
  output: output('object', [
    field('cycleTotalQuota', 'number | string | null', '当前周期总额度', { nullable: true, nullMeaning: '后端未返回或没有可用额度' }),
    field('cycleUsedQuota', 'number | string | null', '当前周期已用额度', { nullable: true, nullMeaning: '后端未返回' }),
    field('cycleRemainingQuota', 'number | string | null', '当前周期剩余额度', { nullable: true, nullMeaning: '后端未返回' }),
    field('currentCycleAvailableQuota', 'number | string | null', '当前周期可用额度', { nullable: true, nullMeaning: '后端未返回' }),
  ], '缺失字段按缺失处理，不能把null或缺席解释成0；请求成功不等于申请已生效。'),
  consume: ['与额度列表使用同一筛选条件但不发送pageNo/pageSize；默认quotaCycle=3、statisticsDimension=2。'],
  steps: [],
  completion: '得到当前企业额度汇总快照。',
  idempotency: null,
}))

const usageInputOverrides = {
  dateRange: param('自定义日期选择器的开始日和结束日；仅timeRangeType=5有意义，SDK把10位日期补成闭区间的00:00:00和23:59:59。', 'Portal UsageTab form.dateRange', { type: 'string[]', required: false, nullable: true }),
  modelId: param('模型主键；来自setting-enterprise-usage-quota-list的list[].modelId或路由模型上下文，不能填用量记录ID。', '企业额度列表或Portal路由query.modelId', { type: 'number | string', required: false, lookup: { capabilityId: 'setting-enterprise-usage-quota-list', args: {}, valueField: 'list[].modelId', labelField: 'list[].modelName' } }),
}

add('setting-enterprise-usage-usage-list', base({
  purpose: '读取企业用量Tab的分页调用明细，供当前租户内按模型、用户、时间、功能模块、状态和明细条件筛选。',
  effect: 'read',
  inputs: inputsFor('setting-enterprise-usage-usage-list', usageInputOverrides),
  output: output('{ list: object[], total: number }', usageRowFields, 'list=[]表示当前企业维度筛选没有调用明细；total用于分页，权限/网络错误会抛出。'),
  consume: [
    '根企业页面默认quotaCycle=2、timeRangeType=2、pageNo=1、pageSize=20，并固定statisticsDimension=2。',
    '企业根页面的请求编号、用户归属、会员等级、限流类型、是否扣减额度属于明细筛选；将这些筛选和主表单条件合并后再读取列表。',
    '使用list[].id调用setting-enterprise-usage-usage-detail；使用list[].functionModule候选值时先调用setting-enterprise-usage-function-module-list，不能把数组索引当功能模块ID。',
  ],
  steps: [],
  completion: '得到当前租户企业维度的一页调用明细；明细里的callStatus仍需按状态值消费，不代表整页调用均成功。',
  idempotency: null,
}))

add('setting-enterprise-usage-usage-analytics', base({
  purpose: '读取企业用量Tab的汇总、趋势、模型占比和功能模块排行，并记录独立统计请求的失败项。',
  effect: 'read',
  inputs: inputsFor('setting-enterprise-usage-usage-analytics', { ...usageInputOverrides, includeBreakdowns: param('是否同时请求趋势、模型占比和功能模块排行；企业根页面默认true，带modelId的模型上下文可传false。', 'Portal ModelUsageContent/UsageTab是否存在modelId上下文', { type: 'boolean', required: false, default: 'true' }) }),
  output: output('object', analysisFields, '某一路统计失败时对应字段为null并在errors记录原因；不要把失败伪装成空数组或0。'),
  consume: [
    '企业根页面无modelId时请求summary、trend、modelRatio、moduleRanking四路；带modelId模型上下文时可用includeBreakdowns=false只取summary。',
    'summary中的额度/Token/调用次数按各字段原值消费；trend、modelRatio、moduleRanking按其数组元素的日期、模型或功能模块维度展示，不跨维度相加。',
  ],
  steps: [],
  completion: '得到带独立错误记录的企业用量分析结果；结果是统计快照，不代表额度申请已经审批或写入已生效。',
  idempotency: null,
}))

add('setting-enterprise-usage-usage-detail', base({
  purpose: '读取一条企业用量调用记录的详情，展示请求、用户、Token、扣减、额度/流速规则和失败信息。',
  effect: 'read',
  inputs: inputsFor('setting-enterprise-usage-usage-detail', { id: param('用量记录主键；不能传模型ID。', 'setting-enterprise-usage-usage-list.result.list[].id或用户选择的详情行', { type: 'number | string', required: true }) }),
  output: output('object', usageDetailFields, '响应失败或请求ID无效时抛错；字段为null表示后端没有该快照/规则，不应替换成0。'),
  consume: ['先从企业用量列表取得id，再展示requestId、callStatus、requestSummary和用户信息；按quotaDeducted判断扣减对象是否有意义。', 'quotaRuleId、flowRuleId、quotaBefore/After、tenantQuotaBefore/After等审计字段可能为空，不能据此断言没有发生其它业务规则。'],
  steps: [],
  completion: '得到指定企业用量记录的详情；详情读取本身不改变用量数据。',
  idempotency: null,
}))

add('setting-enterprise-usage-usage-export', base({
  purpose: '按企业用量当前筛选条件导出全部匹配的调用明细文件。',
  effect: 'read',
  inputs: inputsFor('setting-enterprise-usage-usage-export', usageInputOverrides),
  output: output('object', [
    field('fileName', 'string', '下载文件名；优先使用响应Content-Disposition，否则为模型用量明细.xls'),
    field('contentType', 'string | null', '响应Content-Type', { nullable: true, nullMeaning: '服务端未返回Content-Type' }),
    field('base64', 'string', '文件二进制内容的标准Base64'),
    field('byteLength', 'number', '文件字节数'),
  ], '空文件或非二进制响应抛错；不要把空Base64当导出成功。'),
  consume: ['导出请求与企业用量列表共享筛选字段但不发送pageNo/pageSize，固定statisticsDimension=2；将base64还原保存为文件并核对byteLength。'],
  steps: [],
  completion: '得到可保存的企业用量明细文件；文件下载成功不代表筛选一定有记录。',
  idempotency: null,
}))

add('setting-enterprise-usage-function-module-list', base({
  purpose: '取得企业用量功能模块候选，供用量Tab的功能模块筛选。',
  effect: 'read',
  inputs: inputsFor('setting-enterprise-usage-function-module-list', { keyword: param('本地筛选关键字；不作为请求参数发送。', '用户在功能模块筛选中的搜索意图', { type: 'string', required: false, omitted: '省略或为空时返回接口返回的全部候选；接口只请求一次。' }) }),
  output: output('string[]', [field('[]', 'string', '功能模块名称；Java接口返回String数组，SDK按keyword本地过滤')], '没有候选或本地关键字没有匹配时返回[]；接口请求失败会抛错而不是伪装成无候选。'),
  consume: ['页面挂载时请求一次；keyword只改变本地返回结果，不减少后端全量候选请求，也不能把名称当模块ID。'],
  steps: [],
  completion: '得到可用于企业用量筛选的功能模块名称候选。',
  idempotency: null,
}))

add('setting-enterprise-usage-model-detail', base({
  purpose: '读取带modelId路由进入企业用量明细时的模型上下文信息。',
  effect: 'read',
  inputs: inputsFor('setting-enterprise-usage-model-detail', { id: param('模型主键；不能传用量记录ID。', 'Portal路由query.modelId或企业额度列表的modelId', { type: 'number | string', required: true }) }),
  output: output('object', [
    field('id', 'number | string | null', '模型主键', { nullable: true, nullMeaning: '响应未返回模型ID' }),
    field('modelName', 'string | null', '模型名称', { nullable: true, nullMeaning: '未配置或未返回' }),
    field('availableStatus', 'integer | null', '模型可用状态原值', { nullable: true, nullMeaning: '未返回' }),
    field('supportedFiles', 'string | null', '支持文件类型原字符串；页面按逗号拆分展示', { nullable: true, nullMeaning: '未配置' }),
    field('description', 'string | null', '模型描述', { nullable: true, nullMeaning: '未填写' }),
  ], '模型不存在或会话/网络错误时抛错；不要用路由里的modelName冒充后端详情。'),
  consume: ['只在路由带modelId的模型上下文使用；将id/modelName/availableStatus等用于基础信息展示，不把该读取当作模型配置写入。'],
  steps: [],
  completion: '得到企业用量模型上下文展示所需的模型详情。',
  idempotency: null,
}))

add('setting-enterprise-usage-apply-prepare', base({
  purpose: '按企业用量页面额度提升申请表单规则校验草稿，并生成将要提交的企业维度请求体。',
  effect: 'prepare',
  inputs: inputsFor('setting-enterprise-usage-apply-prepare', {
    draft: param('申请草稿；modelId必填，expectedMonthlyQuota和expectedMaxToken至少填一个，数值为非负整数，reason非空且不超过200字符。', '用户在企业用量ApplyFormModal中的明确输入', { type: 'object', required: true }),
    'draft.modelId': param('申请模型ID；必须来自企业额度列表，不是模型名称。', 'setting-enterprise-usage-quota-list.result.list[].modelId', { type: 'number | string', required: true, lookup: { capabilityId: 'setting-enterprise-usage-quota-list', args: {}, valueField: 'list[].modelId', labelField: 'list[].modelName' } }),
    'draft.monthlyQuota': param('当前月额度快照；页面禁用展示值，可省略。', 'setting-enterprise-usage-quota-list.result.list[].monthlyQuota', { type: 'number | string', required: false, nullable: true }),
    'draft.expectedMonthlyQuota': param('期望月额度；页面允许为空或0，但Java固定校验可能拒绝。', '用户在企业用量申请表单的期望月额度', { type: 'number | string', required: false, nullable: true, constraints: ['Portal本地规则：若与expectedMaxToken同时为空则拒绝；填写时必须是非负整数。'] }),
    'draft.maxTokenPerRequest': param('当前单次最大Token快照；页面禁用展示值，可省略。', 'setting-enterprise-usage-quota-list.result.list[].maxTokenPerRequest', { type: 'number | string', required: false, nullable: true }),
    'draft.expectedMaxToken': param('期望单次最大Token；Portal填写时必须是非负整数。', '用户在企业用量申请表单的期望最大单次Token', { type: 'number | string', required: false, nullable: true }),
    'draft.reason': param('额度申请原因；必填且最多200字符。', '用户在企业用量申请表单的申请原因', { type: 'string', required: true, constraints: ['去除首尾空白后不能为空', '长度不超过200个字符'] }),
  }),
  output: output('{ draft: object, payload: object, warnings: string[] }', [
    ...applyPayloadFields,
    field('draft', 'object', '原始申请草稿；供同一次submit继续使用'),
    field('payload', 'object', '按Portal字段映射且固定statisticsDimension=2的最终请求体'),
    field('warnings[]', 'string', '已知Portal表单和固定Java校验差异的提醒；非空时不能宣称后端必然接受'),
  ], '本地校验失败直接抛错且不发网络请求。'),
  consume: ['把同一次prepare返回的draft交给setting-enterprise-usage-apply-submit；不要把modelName发送给后端。', 'Portal规则是两个期望字段至少一个有值、填写值为非负整数、reason必填且最多200字符；SDK保留该页面规则，不静默替换Java的更严格要求。'],
  steps: [
    { role: 'required', when: '用户确认申请且已处理warnings', capabilityId: 'setting-enterprise-usage-apply-submit', mapping: { draft: 'result.draft' }, instruction: '只把同一次prepare返回的draft交给submit；提交前让用户确认warning可能导致后端拒绝。' },
    { role: 'cancel', when: '用户关闭申请弹窗或在提交前取消', capabilityId: 'setting-enterprise-usage-apply-cancel', mapping: {}, instruction: '丢弃本地draft和payload；Portal没有服务端取消草稿端点。' },
  ],
  completion: '得到可审阅的企业额度申请payload；prepare本身不创建申请记录。',
  idempotency: null,
}))

add('setting-enterprise-usage-apply-submit', base({
  purpose: '提交一个已通过企业用量页面规则校验的额度提升申请。',
  effect: 'write',
  inputs: inputsFor('setting-enterprise-usage-apply-submit', {
    draft: param('同一次prepare返回的企业额度申请草稿；submit会重新执行相同本地校验。', 'setting-enterprise-usage-apply-prepare.result.draft', { type: 'object', required: true }),
  }),
  output: output('number | string', [field('$', 'number | string', '新建额度申请记录ID；只表示申请已受理，不表示审批通过或额度已改变')], '响应不是申请ID时抛错；HTTP成功、true或空响应不能当成已创建。'),
  consume: ['请求是POST /admin-api/ai-token/apply/create，body包含modelId、当前/期望月额度、当前/期望最大Token、statisticsDimension=2和reason；modelName不发送。', 'Java创建接口标注PermitAll但仍需要有效会话；企业申请记录查询另受ai-token:apply:query控制。'],
  steps: [
    { role: 'recovery', when: '提交超时、返回不明确或用户要求确认是否创建', capabilityId: 'setting-enterprise-usage-apply-record-list', instruction: '先按modelId、申请时间和status回查企业申请记录，再决定是否重试；未确认前不要盲目重复创建。' },
    { role: 'cancel', when: '用户在提交前取消', capabilityId: 'setting-enterprise-usage-apply-cancel', mapping: {}, instruction: '提交前仅丢弃本地草稿；提交成功后页面没有服务端撤回能力，不能伪造撤销。' },
  ],
  completion: '仅获得申请ID或通过申请记录回查确认新记录存在时，才能报告申请已受理；审批通过和额度生效需要后续业务回查。',
  idempotency: '后端创建接口没有requestId幂等协议；响应超时先用setting-enterprise-usage-apply-record-list回查，未确认前不重发，避免重复申请。',
}))

add('setting-enterprise-usage-apply-record-list', base({
  purpose: '读取企业用量页面申请记录弹窗中的额度提升申请分页列表。',
  effect: 'read',
  inputs: inputsFor('setting-enterprise-usage-apply-record-list'),
  output: output('{ list: object[], total: number }', [
    ...pageFields,
    field('list[].id', 'number | string | null', '申请记录主键', { nullable: true, nullMeaning: '后端未返回' }),
    field('list[].createTime', 'string | null', '提交时间原值', { nullable: true, nullMeaning: '后端未返回' }),
    field('list[].modelName', 'string | null', '申请模型名称', { nullable: true, nullMeaning: '后端未返回' }),
    field('list[].statisticsDimension', 'integer | null', '申请统计维度；本页面请求固定2', { nullable: true, values: { '2': '企业' } }),
    field('list[].currentMonthlyQuota', 'number | string | null', '申请时当前月额度', { nullable: true, nullMeaning: '未记录' }),
    field('list[].expectedMonthlyQuota', 'number | string | null', '申请期望月额度', { nullable: true, nullMeaning: '只申请Token或后端未记录' }),
    field('list[].currentMaxToken', 'number | string | null', '申请时当前单次最大Token', { nullable: true, nullMeaning: '未记录' }),
    field('list[].expectedMaxToken', 'number | string | null', '申请期望单次最大Token', { nullable: true, nullMeaning: '只申请月额度或后端未记录' }),
    field('list[].reason', 'string | null', '申请原因', { nullable: true, nullMeaning: '未返回' }),
    field('list[].status', 'integer | null', '后端申请状态原值；Java当前枚举为0待处理、3已驳回、4已处理，Portal筛选还存在1/2差异', { nullable: true }),
    field('list[].statusName', 'string | null', '申请状态显示名', { nullable: true, nullMeaning: '后端未返回' }),
  ], 'list=[]且total=0表示没有匹配申请；缺少ai-token:apply:query权限时应抛权限错误而非伪装为空列表。'),
  consume: ['默认pageNo=1、pageSize=20、statisticsDimension=2；modelId来自企业额度列表。', 'dateRange按Portal buildApplyQuery原样发送startDate/endDate日期字符串，不补00:00:00/23:59:59；status按页面值原样透传，不将1/2解释成Java已确认状态。'],
  steps: [],
  completion: '得到可核对的企业额度申请分页；申请记录状态不等于当前额度已经改变。',
  idempotency: null,
}))

add('setting-enterprise-usage-apply-cancel', base({
  purpose: '取消企业额度申请弹窗中的未提交草稿。',
  effect: 'local',
  inputs: inputsFor('setting-enterprise-usage-apply-cancel'),
  output: output('{ cancelled: boolean }', [field('cancelled', 'boolean', '固定为true，表示本地草稿已丢弃')], '只返回本地取消结果，不调用后端删除申请接口。'),
  consume: ['释放prepare返回的draft和payload；若submit已经成功，不能用此能力声称服务端申请已撤回。'],
  steps: [],
  completion: '本地未提交草稿已丢弃。',
  idempotency: null,
}))

export const SETTING_ENTERPRISE_USAGE_AI_CONTRACTS: Record<string, AiContract> = contracts
export const SETTING_ENTERPRISE_USAGE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_ENTERPRISE_USAGE_METHODS).map(([id, method]) => [
    `settingEnterpriseUsage.${method}`,
    {
      ...SETTING_ENTERPRISE_USAGE_AI_CONTRACTS[id]!,
      boundaries: [...SETTING_ENTERPRISE_USAGE_AI_CONTRACTS[id]!.boundaries, `直接方法使用sdk.settingEnterpriseUsage.${method}；企业统计维度仍固定为2，复杂申请遵循同一份prepare→submit→cancel说明。`],
    },
  ]),
)
