import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_DATE_CONFIG_METHODS } from '../capabilities/finance-setting-date-config.js'

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

const statusOptions = [{ value: 0, label: '停用' }, { value: 1, label: '启用' }]
const timeDimensionOptions = [{ value: '1', label: '日' }, { value: '2', label: '周' }, { value: '3', label: '月' }]

const id = input(
  '支付计划时间管理主记录ID；不是租户ID、周次ID或列表下标，长ID保留字符串。',
  'finance-setting-date-config-list.list[].id 或 finance-setting-date-config-create 根返回值',
  { type: 'string | number', constraints: ['安全正整数或无前导零的正整数字符串'] },
)

const yearMonth = (required: boolean, source: string): AiParameter => ({
  ...input('支付计划配置所属年月，格式YYYY-MM；不是具体日期或周次日期。', source, {
    type: 'string',
    required,
    format: 'YYYY-MM',
    constraints: ['创建时不能早于SDK当前Asia/Shanghai月份；列表查询允许传空字符串表示不按年月筛选'],
  }),
  ...(required ? {} : { omitted: '省略时SDK沿用Portal列表默认的当前月份' }),
})

const weekList = optional(
  '周维度的日期范围数组；每项是[startDate,endDate]，不是后端已经展开的周对象。',
  '用户在新增表单中添加的周次日期范围；来自finance-setting-date-config-prepare-create.draft.weekList时可直接复用',
  '非周维度由SDK发送空数组；周维度不能省略或传空数组',
  {
    type: 'array',
    requiredWhen: 'timeDimension为字符串"2"（周）时必填且至少一项；Portal没有额外的周次数量上限',
    constraints: ['每项必须是两个YYYY-MM-DD日期；日期必须属于yearMonth；同一周起止日期不能倒序且不同周不能重叠'],
  },
)

const rowFields = (prefix: string): AiField[] => [
  field(`${prefix}.id`, 'string | number', '支付计划时间管理主记录ID；启停动作使用它'),
  field(`${prefix}.tenantName`, 'string', '所属租户名称；页面原文显示，不据此反推租户ID'),
  field(`${prefix}.yearMonth`, 'string', '配置所属年月', { format: 'YYYY-MM' }),
  field(`${prefix}.timeDimensionName`, 'string', '提报时间维度名称；页面列展示该文本，不把它当作可提交的字典值'),
  field(`${prefix}.weekList`, 'array', '周维度的页面展示日期范围；非周维度后端通常不返回该数组', { nullable: true, nullMeaning: '该记录不是周维度或后端未填充周次列表' }),
  field(`${prefix}.weekList[]`, 'object', '一条页面展示周次'),
  field(`${prefix}.weekList[].weekName`, 'string', 'Portal生成的周次名称，如第1周'),
  field(`${prefix}.weekList[].startDate`, 'string', '周次起始日期', { format: 'YYYY-MM-DD' }),
  field(`${prefix}.weekList[].endDate`, 'string', '周次结束日期', { format: 'YYYY-MM-DD' }),
  field(`${prefix}.status`, 'integer', '绝对状态；0停用、1启用，页面根据它决定显示启用或停用动作', { values: { '0': '停用', '1': '启用' } }),
  field(`${prefix}.updateTime`, 'string | number', '更新时间原值；页面格式化展示，SDK不做时区换算', { nullable: true, nullMeaning: '后端未返回更新时间' }),
]

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/menus/finance.js 与 app/portal/views/dashboard/finance/setting/date-config.vue',
    kind: 'reference',
    note: '证明菜单标题、菜单路径、页面permission=/dashboard/finance/setting/date-config及列表页入口；当前固定检出比origin/test/portal/main落后2个提交，未按任务禁令pull。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/date-config/list.vue',
    kind: 'reference',
    note: '证明列表GET /admin-api/finance/payment-plan-time-management/page、默认筛选字段、platform实例、新增权限finance:setting:date-config:create、启停权限finance:setting:date-config:status，以及没有编辑/删除按钮。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/date-config/[mode]/[id].vue',
    kind: 'reference',
    note: '证明新增表单固定status=1、时间维度字典值为字符串、周日期校验、weekList转换和POST /admin-api/finance/payment-plan-time-management/create；该表单当前没有编辑提交分支。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 PaymentPlanTimeManagementController、SaveReqVO、RespVO、ServiceImpl',
    kind: 'reference',
    note: '证明page/create/update-status端点、请求字段、周次后端约束、启用状态按年月唯一，以及已有收入预算或当前月份停用等业务失败条件；后端固定检出比origin/test/test落后12个提交，未按任务禁令pull。',
  },
  {
    source: 'src/capabilities/finance-setting-date-config.ts',
    kind: 'implementation',
    note: '证明SDK只暴露列表、prepareCreate、create和setStatus，platform上下文显式不发送module-type，启停复刻FormData字段，创建载荷和日期约束由本地代码执行。',
  },
  {
    source: 'test/finance-setting-date-config.test.ts',
    kind: 'test',
    note: '离线request stub锁定请求、权限/moduleType声明、表单载荷、启停FormData、失败响应和AI契约反证；不调用真实环境。',
  },
]

const gaps = [
  '本轮未启动浏览器，未取得该页独立网络基准、真实按钮权限结果、响应字段键序或部署版本行为；请求和字段语义来自当前固定源码、后端源码与离线stub测试。',
  'Portal固定检出d3cf56bdc7、后端固定检出dcb3f360194分别落后远端2/12个提交；因任务明确禁止Git写命令，未执行pull，不能把当前源码称为最新部署证据。',
  '未在真实测试环境执行创建或启停，没有prepare→submit→cancel真实写入闭环，也没有真实记录可供清理；页面和后端没有删除接口，SDK不伪造删除/回滚能力。',
  '提交日期、启用状态唯一性、已有收入预算禁止变更及“当前月份不可停用”等规则来自后端静态实现，未通过真实环境回执独立验证；租户名称搜索的真实权限范围也未实测。',
]

const boundaries = [
  '只覆盖菜单“财务设置→支付计划时间管理”PC列表与其实际新增表单；不发布后端存在但页面没有调用的get、update、export-excel、get-by-year-month、batch-set-monthly-week-plans或is-month-configured。',
  '页面权限为/dashboard/finance/setting/date-config；新增按钮还要求finance:setting:date-config:create，启停按钮还要求finance:setting:date-config:status。菜单可见性不是后端权限裁决，SDK不预判账号一定有权限。',
  '页面列表和新增请求使用platform HTTP实例；页面moduleType为null，SDK不发送module-type头。调用方仍须用当前会话token和tenantId绑定的HTTP上下文。',
  '新增只创建启用状态记录；页面没有编辑或删除动作，status=0只是停用，不是删除或事务回滚。',
  '列表筛选只复刻tenantName、yearMonth、status、pageNo、pageSize及renren默认order/orderField；不借此扩展timeDimension或租户ID筛选。',
]

const prerequisites = [
  '已建立带有效会话token和tenantId的SDK；账号需拥有页面及具体新增/启停按钮权限。',
  '启停的id、currentStatus必须来自同一次最新列表读取，目标status必须是用户明确选择且与currentStatus相反。',
  '新增时yearMonth、timeDimension和周日期范围必须来自用户确认的表单数据；周维度必须先完成所有周次日期校验。',
]

const failures = [
  '参数格式、年月、过去月份、时间维度、空周次、跨月日期、倒序日期或重叠周次校验失败时不发请求；修正输入后才可重试。',
  '新增后端可能因同年月已有启用配置、已有收入预算数据或其它业务校验拒绝；请求未成功时不报告创建成功，按后端错误修正或重新查询后再试。',
  '启停目标与currentStatus相同或FormData回执不是true时抛错；不要把普通网络错误当成状态已改变，先list回查同一ID再决定是否重试。',
  '401/403、网络错误和响应结构错误原样失败，不转换为空列表或成功；超时写入结果不确定，必须先独立list核对ID/字段。',
]

function contract (
  value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'> &
    Partial<Pick<AiContract, 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>>,
): AiContract {
  return {
    whenToUse: '操作门户“财务设置→支付计划时间管理”页面；用于查询某年月的配置、新增当前或未来月份的支付计划时间，以及按列表行切换启用/停用。不用于编辑已有配置、删除记录或调用其它业务页面的同名日期接口。',
    boundaries,
    prerequisites,
    failures,
    evidence,
    gaps,
    ...value,
  }
}

const listOutput: AiContract['output'] = {
  shape: '{ list: array, total: integer }',
  fields: [
    field('$', 'object', '支付计划时间管理当前分页结果'),
    field('list', 'array', '当前页配置记录；不是全部页'),
    field('list[]', 'object', '一条页面列表行'),
    ...rowFields('list[]'),
    field('total', 'integer', '当前筛选条件下的记录总数；不是当前页长度', { constraints: ['非负整数；list=[]且total>0表示当前页没有行，不代表没有配置'] }),
  ],
  empty: 'list=[]且total=0表示当前租户/权限范围内没有匹配配置；权限、网络或响应校验失败会抛错，不会转换为空数组。',
}

const createDraftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('$', 'object', '本地新增准备结果；尚未发送POST'),
    field('draft', 'object', '可逐字段传给create的用户层草稿；status由SDK固定为1，不在输入中填写'),
    field('draft.yearMonth', 'string', '所属年月', { format: 'YYYY-MM' }),
    field('draft.timeDimension', 'string', 'Portal字典字符串值：1日、2周、3月', { values: { '1': '日', '2': '周', '3': '月' } }),
    field('draft.weekList', 'array', '用户层周次范围数组；每项是[startDate,endDate]，create会生成后端周对象'),
    field('draft.weekList[]', 'array', '一项周次范围，长度为2'),
    field('draft.weekList[][]', 'string', '周次范围中的起始或结束日期', { format: 'YYYY-MM-DD' }),
  ],
  empty: '输入非法时抛错且不返回草稿；日/月维度返回weekList=[]，周维度返回至少一项的非重叠范围。',
}

const trueOutput: AiContract['output'] = {
  shape: 'boolean',
  fields: [field('$', 'boolean', '后端业务成功标志；SDK只接受true', { values: { true: '请求被后端接受' } })],
  empty: 'false、缺失或其它值都会抛错；true不代表数据库已独立回查或业务已经产生后续单据。',
}

export const FINANCE_SETTING_DATE_CONFIG_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-date-config-list': contract({
    purpose: '按所属租户名称、年月、启用状态查询支付计划时间管理分页，返回页面显示的租户、年月、提报维度、周次日期、状态和更新时间。',
    effect: 'read',
    inputs: {
      tenantName: optional('所属租户名称包含筛选；不是租户ID。', '用户在列表“租户名称”输入框输入的文字', '省略或传null时发送空字符串', { type: 'string', nullable: true, nullMeaning: '不按租户名称筛选' }),
      yearMonth: yearMonth(false, '用户列表筛选；省略时使用当前月份'),
      status: optional('记录绝对状态。', '用户在列表状态单选框选择', '省略时发送1（启用）', { type: 'integer', options: statusOptions }),
      pageNo: optional('从1开始的当前页码。', '调用方分页状态', '省略时SDK使用1', { type: 'integer', constraints: ['正整数'] }),
      pageSize: optional('当前页条数。', '调用方分页状态', '省略时SDK使用20', { type: 'integer', constraints: ['只能是10、20、50或100，不能传-1全量'] }),
    },
    output: listOutput,
    consume: [
      '展示list[].tenantName、yearMonth、timeDimensionName、weekList、status和updateTime；weekList为null时不要把它显示成一条虚构周次。',
      '保留同一行的list[].id与list[].status；启停时把它们分别映射为id和currentStatus，并把用户明确的相反状态作为status。',
      '按total和pageNo/pageSize继续翻页；不能把当前页当成全部配置，也不能从timeDimensionName反推未返回的字典值。',
    ],
    steps: [
      { role: 'optional', when: '用户点击新增且账号具备finance:setting:date-config:create权限', capabilityId: 'finance-setting-date-config-prepare-create', mapping: {}, instruction: '向用户收集yearMonth、timeDimension；只有选择周维度时再收集不重叠的月内周次日期范围。' },
      { role: 'optional', when: '用户明确要切换选中行状态且账号具备finance:setting:date-config:status权限', capabilityId: 'finance-setting-date-config-set-status', mapping: { id: 'result.list[].id', currentStatus: 'result.list[].status', status: 'user.targetStatus' }, instruction: '只把用户选中的同一行映射给动作；targetStatus必须是0或1且与currentStatus相反。' },
    ],
    completion: '返回当前筛选条件下的一页和total；这只证明读取成功，不证明任何配置已新增、生效或满足后续业务使用条件。',
    idempotency: null,
  }),

  'finance-setting-date-config-prepare-create': contract({
    purpose: '校验新增支付计划时间配置的年月、提报维度和周次范围，生成尚未写入的表单草稿。',
    effect: 'prepare',
    inputs: {
      yearMonth: yearMonth(true, '用户确认的新增所属年月'),
      timeDimension: input('提报时间维度字典字符串值。', '用户选择的Portal字典项', { type: 'string', options: timeDimensionOptions }),
      weekList,
    },
    output: createDraftOutput,
    consume: [
      '确认draft.yearMonth不能早于当前月份；确认draft.timeDimension的字符串值与用户选择一致。',
      '周维度逐项读取draft.weekList[][]并确认范围属于同一年月、起止不倒序且不同周不重叠；日/月维度保持空数组。',
      '不要自行把draft.weekList的范围改成后端weekName/weekNumber对象；create会按Portal顺序生成这些字段。',
    ],
    steps: [{ role: 'required', when: '用户确认准备结果中的年月、维度和周次范围后', capabilityId: 'finance-setting-date-config-create', mapping: { yearMonth: 'result.draft.yearMonth', timeDimension: 'result.draft.timeDimension', weekList: 'result.draft.weekList' }, instruction: '按映射逐字段提交；status由SDK固定为1，不要额外构造status或编辑/删除字段。' }],
    completion: '返回本地已校验草稿，尚未创建后端记录；只有后续create返回ID并经列表独立核对才可报告新增已验证。',
    idempotency: null,
  }),

  'finance-setting-date-config-create': contract({
    purpose: '按新增表单创建一条启用状态的支付计划时间管理记录，并返回后端分配的主键。',
    effect: 'write',
    inputs: {
      yearMonth: yearMonth(true, 'finance-setting-date-config-prepare-create.draft.yearMonth'),
      timeDimension: input('提报时间维度字典字符串值。', 'finance-setting-date-config-prepare-create.draft.timeDimension', { type: 'string', options: timeDimensionOptions }),
      weekList,
    },
    output: {
      shape: 'string | number',
      fields: [field('$', 'string | number', '新建支付计划时间管理主键ID；不是周次ID或租户ID')],
      empty: '成功必须返回安全正ID；缺失或非法ID会抛错，不能当成创建成功。',
    },
    consume: [
      'SDK把status固定为1；将timeDimension和yearMonth原样放入POST，并按weekList顺序生成第1周、第2周等weekName和1开始的weekNumber。',
      '保存返回的根ID；用list分页查找同一ID，核对yearMonth、timeDimensionName/维度和status=1，不能只凭POST回执认定记录已落库。',
    ],
    steps: [
      { role: 'required', when: 'POST返回ID或请求超时后需要确认写入结果', capabilityId: 'finance-setting-date-config-list', mapping: {}, instruction: '分页读取并按result.$精确定位同一ID；核对目标年月、维度、周次和status=1。超时先核对再决定是否重试。' },
      { role: 'cancel', when: '创建记录已经由list确认，用户明确要求暂时停用且后端允许停用该年月', capabilityId: 'finance-setting-date-config-set-status', mapping: { id: 'result.$', currentStatus: 'literal:1', status: 'literal:0' }, instruction: '这只是状态补偿，不是删除或事务回滚；先确认记录仍为1且年月满足后端停用条件，停用后再次list回查。' },
    ],
    completion: '返回后端主键只代表请求返回了ID；只有list确认同一ID及目标字段后才能报告记录创建已验证，审批/预算业务生效不由本能力完成。',
    idempotency: '后端端点和SDK都没有requestId幂等包装；重复create可能产生重复记录或被同年月启用唯一性拒绝。超时必须先按ID/年月/维度回查，不能盲目重发。',
  }),

  'finance-setting-date-config-set-status': contract({
    purpose: '把列表中选定的支付计划时间管理记录切换到用户明确的启用或停用绝对状态。',
    effect: 'write',
    inputs: {
      id,
      currentStatus: input('操作前列表行的当前绝对状态；用于防止过期切换。', 'finance-setting-date-config-list.list[].status', { type: 'integer', options: statusOptions, constraints: ['必须来自最新列表读取'] }),
      status: input('用户确认的目标绝对状态；不是无条件toggle。', '用户明确的启用/停用意图', { type: 'integer', options: statusOptions, constraints: ['必须与currentStatus相反'] }),
    },
    output: trueOutput,
    consume: [
      'SDK只把id和status以FormData字段发送；currentStatus只用于本地防止过期切换，不进入请求体。',
      'true回执后用list按同一ID回查status；停用不代表删除，也不代表其它收入/支出预算业务已经撤销。',
    ],
    steps: [
      { role: 'required', when: 'POST返回true或请求超时后需要核实状态', capabilityId: 'finance-setting-date-config-list', mapping: {}, instruction: '按页查找args.id并确认status等于args.status；权限/网络错误不能当成已停用或已启用。' },
      { role: 'cancel', when: '目标状态已回查且用户明确要求恢复原状态', capabilityId: 'finance-setting-date-config-set-status', mapping: { id: 'args.id', currentStatus: 'args.status', status: 'context.previousStatus' }, instruction: 'previousStatus必须保存自同一次调用前的args.currentStatus；恢复仍受后端年月和预算业务规则限制，完成后再次list回查。' },
    ],
    completion: '只有POST返回true且list确认同一ID达到目标status，才能报告状态切换已验证；不能把HTTP成功直接解释为配置可用于所有后续业务。',
    idempotency: '端点没有requestId；目标是绝对状态，重复同一目标通常不会反向切换，但超时仍需先回查，不能盲目重试或改传相反状态。',
  }),
}

export const FINANCE_SETTING_DATE_CONFIG_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_DATE_CONFIG_METHODS).map(([capabilityId, method]) => {
    const source = FINANCE_SETTING_DATE_CONFIG_AI_CONTRACTS[capabilityId]!
    return [`financeSettingDateConfig.${method}`, {
      ...source,
      boundaries: [...source.boundaries, `公开方法 financeSettingDateConfig.${method} 接受单个对象参数；字段与inputs一致，list可省略对象使用页面默认筛选。`],
    }]
  }),
)
