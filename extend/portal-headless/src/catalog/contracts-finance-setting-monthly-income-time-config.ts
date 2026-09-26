import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_METHODS } from '../capabilities/finance-setting-monthly-income-time-config.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: false,
  nullable: false,
  ...extra,
})

const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning,
  source,
  required: true,
  ...extra,
})

const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, {
  required: false,
  omitted,
  ...extra,
})

const bizTypeOptions = [
  { value: 1, label: '月度收入预算（资金）' },
  { value: 2, label: '月度收入预算（预测）' },
  { value: 3, label: '其他资金流入预算（资金）' },
  { value: 4, label: '其他资金流入预算（预测）' },
]

const bizType = input(
  '平台管理员列表中的业务类型筛选值。1/2是主营月度收入预算，3/4是其他资金流入预算；每个值还区分资金或预测场景。',
  '平台管理员在页面“业务类型”下拉框中的数值选择',
  { type: 'integer', nullable: true, nullMeaning: '不按业务类型筛选；Portal表单清空后可能为null，省略时SDK保留undefined。', options: bizTypeOptions, required: false, omitted: '不按业务类型筛选。', constraints: ['只能是数值1、2、3、4；不能传标签文字。'] },
)

const tenantId = optional(
  '平台管理员列表中的租户主键；不是当前会话的tenant-id头，也不是配置记录id。',
  '平台管理员在页面“租户ID”输入框填写的正整数；长ID应保留字符串',
  '不按租户筛选；SDK保留请求参数键但HTTP层会跳过undefined/null。',
  { type: 'string | number', nullable: true, nullMeaning: '不按租户筛选；不能把null解释为当前租户。', constraints: ['安全正整数或无前导零的正整数字符串。'] },
)

const pageNo = optional(
  '从1开始的管理员列表页码。',
  '调用方分页状态',
  'SDK默认1。',
  { type: 'integer', constraints: ['必须为正整数。'] },
)

const pageSize = optional(
  '管理员列表每页条数。',
  '调用方分页状态或页面分页器',
  'SDK默认20；页面支持10、20、50、100。',
  { type: 'integer', constraints: ['只能是10、20、50或100；不接受-1全量。'] },
)

const itemBizType = input(
  '更新数组中一项的业务类型；四类必须各出现一次。',
  'finance-setting-monthly-income-time-config-get结果中的[].bizType，或用户确认的固定业务类型',
  { type: 'integer', options: bizTypeOptions, constraints: ['只能是1、2、3、4；同一update的items不能重复或缺失。'] },
)

const itemLockDay = input(
  '该业务类型每月允许填报的截止自然日。',
  '用户在普通用户表单对应业务类型的“截止日”选择器中选择；也可沿用get结果后修改',
  { type: 'integer', constraints: ['必须为1至31的整数；页面表单四项均有必填校验，不能提交null或缺失。'] },
)

const itemRemark = optional(
  '该业务类型的备注原值；页面不提供编辑控件，但保存时会随表单一起提交。',
  'finance-setting-monthly-income-time-config-get结果中的[].remark，或用户明确保留的备注',
  '按Portal表单逻辑转为空字符串。',
  { type: 'string', nullable: true, nullMeaning: '后端备注为空；提交时SDK转为Portal发送的空字符串。' },
)

const updateItems: Record<string, AiParameter> = {
  items: input(
    '四类配置的批量更新数组；SDK按业务类型1、2、3、4规范化顺序后发送。',
    '普通用户先调用finance-setting-monthly-income-time-config-get得到四项，再替换用户明确修改的lockDay',
    { type: 'array', constraints: ['必须恰好四项并覆盖1、2、3、4各一次；不能发送空数组、重复业务类型或额外业务类型。'] },
  ),
  'items[]': input('批量更新数组中的一项配置对象。', 'args.items中的一个元素', { type: 'object' }),
  'items[].bizType': itemBizType,
  'items[].lockDay': itemLockDay,
  'items[].remark': itemRemark,
}

const rowFields = (prefix: string): AiField[] => [
  field(`${prefix}.id`, 'string | number', '月度收入时间配置记录主键；仅用于识别平台管理员列表行，不是update请求字段。', { source: 'Java响应id' }),
  field(`${prefix}.bizType`, 'integer', '预算业务类型。', { values: { '1': '月度收入预算（资金）', '2': '月度收入预算（预测）', '3': '其他资金流入预算（资金）', '4': '其他资金流入预算（预测）' } }),
  field(`${prefix}.lockDay`, 'integer', '每月允许填报的截止自然日。', { nullable: true, nullMeaning: '该列表行没有可用截止日；页面显示破折号，普通用户保存时不能提交null。', constraints: ['有效写入值为1至31。'] }),
  field(`${prefix}.remark`, 'string', '该业务类型的备注原值。', { nullable: true, nullMeaning: '后端没有备注；普通用户表单会显示/提交为空字符串。' }),
  field(`${prefix}.tenantId`, 'string | number', '配置所属租户主键；用于解释平台管理员列表筛选范围。', { source: 'Java响应tenantId' }),
]

const formFields: AiField[] = [
  field('$', 'array', '当前租户四类月度收入填报截止配置；SDK按业务类型1、2、3、4补齐并排序。'),
  field('[]', 'object', '一项普通用户表单配置。'),
  field('[].bizType', 'integer', '配置业务类型。', { values: { '1': '月度收入预算（资金）', '2': '月度收入预算（预测）', '3': '其他资金流入预算（资金）', '4': '其他资金流入预算（预测）' } }),
  field('[].lockDay', 'integer', '每月填报截止自然日；表单初始读取缺少该值时保留null，保存前必须选1至31。', { nullable: true, nullMeaning: '源响应缺少该业务类型或截止日；不能直接作为update输入。' }),
  field('[].remark', 'string', '备注；Portal创建表单行时把null/缺失归一为空字符串。'),
]

const boolOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'boolean', '后端更新接口返回true；只表示请求被服务端接受，不包含更新后的四项配置。', { values: { 'true': '保存请求成功返回' } })],
  empty: '不会返回空值或更新明细；非true响应会抛错。',
}

const evidence: AiContract['evidence'] = [
  {
    source: 'generated/page-catalog.json item 51f696',
    kind: 'reference',
    note: '锁定菜单路径、标题、permission、声明式getDataListURL列表形态、write=true、menuSource和moduleType=null；生成物未在本任务中修改。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/menus/finance.js；app/portal/views/dashboard/finance/setting/monthly-income-time-config.vue；其list.vue',
    kind: 'reference',
    note: '静态锁定管理员/普通用户分支、page/get/update三个路径、默认筛选字段、四类业务类型、1-31日表单规则、update按钮权限和本地取消语义；不是浏览器网络实测。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f36019 MonthlyIncomeBudgetEditConfigController/ServiceImpl/Mapper/VO/MonthlyIncomeBudgetEditBizTypeEnum',
    kind: 'reference',
    note: '静态锁定请求字段、响应字段、业务类型值、更新@PreAuthorize、1-31后端校验、当前租户默认值初始化和平台分页排序；不是部署环境实测。',
  },
  {
    source: 'src/capabilities/finance-setting-monthly-income-time-config.ts',
    kind: 'implementation',
    note: '锁定SDK请求键序、字段投影、四类表单归一、1-31校验、platform实例和moduleType=null；不替代浏览器或真实环境证据。',
  },
  {
    source: 'test/finance-setting-monthly-income-time-config.test.ts',
    kind: 'test',
    note: '离线锁定页面元数据、请求路径/载荷、默认值、权限分支、头部、响应投影、坏输入和AI映射；测试不发网络、不证明真实权限或写入效果。',
  },
]

const gaps = [
  '本轮按任务要求未启动浏览器，未生成该页脱敏baseline；请求键序、platform序列化和module-type结论来自Portal源码、Java源码与离线请求桩，不称为浏览器实测。',
  '未执行真实环境读冒烟，也未执行get→update→get的真实写闭环；update成功后的配置生效、超时后的最终状态和恢复操作均未在线验证。',
  'Portal固定检出当前提交d3cf56bdc7相对origin/test/portal/main落后2个提交，Java固定检出当前提交dcb3f36019相对origin/test/test落后12个提交；本任务禁止pull，静态结论只覆盖当前检出。',
  '当前Portal/Java源码将page与get的查询权限注释为联调期间仅保留登录态；部署环境是否仍如此、以及菜单permission与后端登录态的实际裁决未验证。',
  'Java的get与update服务都会ensureDefaults补齐缺失的四类默认25日记录；这是源码可见的GET伴随写入行为，但本轮未真实验证首次读取是否插入以及事务结果。',
]

const boundaries = [
  '页面路径对应菜单permission /dashboard/finance/setting/monthly-income-time-config；管理员分支只查询跨租户page列表，普通用户分支读取当前租户get并保存update。',
  '页面没有启停、删除、新增、单条编辑或独立cancel接口；“取消”只把未提交表单恢复到最近一次get的initialItems，不发业务请求。',
  '所有请求都使用Portal platform实例；页面规则无法推导module-type，SDK与Portal一致不发送module-type，统一会话仍负责token、tenant-id和租户绑定。',
  'update权限码为finance:monthly-income-budget-edit-config:update；页面只在permissionCheck通过时显示保存按钮，SDK不会伪造权限，缺权时保留后端错误。',
  '业务类型只覆盖1、2、3、4；页面表单固定四项，lockDay必须在1至31。平台列表的id和tenantId仅用于识别/筛选，不应放入update.items。',
]

function contract (
  purpose: string,
  effect: AiContract['effect'],
  inputs: Record<string, AiParameter>,
  output: AiContract['output'],
  consume: string[],
  steps: AiContract['steps'],
  completion: string,
): AiContract {
  return {
    purpose,
    whenToUse: '操作门户“财务设置→月度收入时间配置”页面；按账号是否为管理员选择跨租户列表或当前租户四类截止日配置，不用于月度收入预算金额填报本身。',
    boundaries,
    effect,
    prerequisites: [
      '已建立带有效会话token和tenantId的platform SDK请求；一个HTTP实例只服务一个用户和一个租户。',
      '调用update前必须取得同一租户最近一次get结果，并由用户明确确认四类lockDay变更；账号还必须具有finance:monthly-income-budget-edit-config:update权限。',
    ],
    inputs,
    output,
    consume,
    steps,
    completion,
    failures: [
      'tenantId、bizType或分页参数非法，或update.items不是恰好覆盖1、2、3、4的四项：SDK不发请求；修正输入后重试。',
      'lockDay缺失、不是整数或不在1至31：SDK不发请求；按页面每项必填规则补齐合法截止日。',
      '列表/读取响应缺少必需容器或字段，或更新响应不是true：SDK抛错，不改写为空列表、空配置或成功；核对部署响应后再决定。',
      '401/403、网络错误或后端业务错误原样抛出；权限失败先恢复会话/权限，不能当成当前租户无配置。',
      'update超时或断网时结果不确定：先调用get核对四类目标值，确认未生效后才按同一完整载荷重试；不要把请求回执当作配置已生效。',
    ],
    idempotency: effect === 'write' ? 'update没有requestId或SDK幂等包装；它是四项配置的绝对覆盖写入，重复请求可能覆盖并发修改。超时先get核实，恢复也是一次新的PUT，不是事务回滚。' : null,
    evidence,
    gaps,
  }
}

export const FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-monthly-income-time-config-list': contract(
    '按租户和业务类型分页查询月度收入填报截止配置，返回平台管理员表格展示及租户范围判断所需字段。',
    'read',
    { tenantId, bizType, pageNo, pageSize },
    {
      shape: '{ list: array, total: integer }',
      fields: [
        field('$', 'object', '当前筛选条件的分页结果。'),
        field('list', 'array', '当前页配置记录，不是全部租户记录。'),
        field('list[]', 'object', '一条平台管理员列表记录。'),
        ...rowFields('list[]'),
        field('total', 'integer', '当前tenantId/bizType筛选条件下的总记录数；不是当前页长度。'),
      ],
      empty: 'list=[]且total=0表示筛选无记录；list=[]但total>0可能是pageNo超出，不代表全部范围无配置。网络/权限/响应错误会抛出而不是变成空列表。',
    },
    [
      '按bizType值解释四类业务类型；lockDay为null时按页面破折号语义展示，remark为null时按空值展示。',
      '使用list[].tenantId和list[].id识别平台记录；这些字段不映射为普通用户update.items中的字段。',
      '需要完整结果时保持筛选不变递增pageNo，直到累计记录达到total；不能把第一页当成全部租户配置。',
    ],
    [],
    '交付当前筛选页及total；该能力不修改配置，也不能证明任何租户的配置已生效。',
  ),

  'finance-setting-monthly-income-time-config-get': contract(
    '读取当前会话租户的四类月度收入填报截止日配置，并按Portal普通用户表单顺序补齐缺失项。',
    'read',
    {},
    {
      shape: 'array',
      fields: formFields,
      empty: '合法响应会返回四项；源响应缺失某业务类型时该项为lockDay=null、remark=""，不是无配置列表。请求或字段校验失败会抛错。',
    },
    [
      '按[].bizType把四项绑定到页面标签；不要以数组下标代替业务类型。',
      'lockDay为null表示源响应缺失/未提供截止日，不能直接作为update输入；保存前必须由用户为每项选择1至31。',
      '保留get结果作为initialItems；用户点击页面“取消”时只恢复这份本地快照，不调用后端cancel接口。',
    ],
    [
      { role: 'required', when: '用户在四项表单中修改lockDay并点击保存，且每项校验通过', capabilityId: 'finance-setting-monthly-income-time-config-update', mapping: { items: 'result.$' }, instruction: '以get返回的四项为基础只替换用户明确修改的lockDay；update会按1、2、3、4发送bizType、lockDay、remark三字段。' },
    ],
    '已交付当前租户四项表单值；仅表示读取完成，不表示保存或默认值初始化已被线上核实。',
  ),

  'finance-setting-monthly-income-time-config-update': contract(
    '提交普通用户表单中的四类月度收入填报截止日配置，对应Portal一次性PUT保存全部items。',
    'write',
    updateItems,
    boolOutput,
    [
      '提交前确认items来自同一次get的四项，四类业务类型各一项；SDK会按1、2、3、4排序并把remark的null/缺失转为空字符串。',
      '请求只发送items[].bizType、items[].lockDay、items[].remark；不发送配置记录id、tenantId或页面展示标签。',
      'PUT返回true只代表服务端接受请求；必须随后调用get逐项核对四个lockDay，才能报告配置已生效。',
    ],
    [
      { role: 'required', when: '用户已确认四项目标值且update返回true或结果不确定，需要确认终态', capabilityId: 'finance-setting-monthly-income-time-config-get', mapping: {}, instruction: '重新读取当前租户四项，逐项比较bizType与目标lockDay；读取失败或任一值不符都只能报告未确认。' },
      { role: 'cancel', when: '更新已核实且用户明确要求恢复，调用方仍保存同一次get的initialItems', capabilityId: 'finance-setting-monthly-income-time-config-update', mapping: { items: 'context.previousItems' }, instruction: '先get确认当前值仍是本次目标，再把同一get快照作为完整items重新PUT；这是反向覆盖写入，不是后端事务回滚。' },
    ],
    'PUT返回true且后续get确认四个业务类型的lockDay全部等于目标值后，才报告配置已生效；没有回查时只能报告请求回执。',
  ),
}

export const FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_METHODS).map(([capabilityId, method]) => {
    const source = FINANCE_SETTING_MONTHLY_INCOME_TIME_CONFIG_AI_CONTRACTS[capabilityId]!
    return [`financeSettingMonthlyIncomeTimeConfig.${method}`, {
      ...source,
      boundaries: [
        ...source.boundaries,
        `公开方法签名financeSettingMonthlyIncomeTimeConfig.${method}(args)，单个对象参数；get可省略args。能力invoke同样使用对象，字段与inputs一致。`,
      ],
    }]
  }),
)
