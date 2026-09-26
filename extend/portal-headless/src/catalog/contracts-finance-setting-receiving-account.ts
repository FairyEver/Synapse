import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_RECEIVING_ACCOUNT_METHODS } from '../capabilities/finance-setting-receiving-account.js'

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

const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不要用名称、行号、租户ID或组织名称代替ID']
const statusOptions = [{ value: 0, label: '启用' }, { value: 1, label: '停用' }]
const optionalFilter = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, {
  required: false,
  omitted,
  ...extra,
})

const listInputs: Record<string, AiParameter> = {
  organizationId: optionalFilter('所属组织ID；不是组织名称或法人库ID', '用户从页面所属组织树选择，或调用方明确指定', 'SDK发送空字符串，不限制所属组织', {
    type: 'string | number', nullable: true, nullMeaning: '不按组织筛选', constraints: idRules,
  }),
  corporationId: optionalFilter('所属法人库ID；不是组织ID或法人名称', '用户从页面所属法人候选中选择，或调用方明确指定', 'SDK发送空字符串，不限制所属法人', {
    type: 'string | number', nullable: true, nullMeaning: '不按法人筛选', constraints: idRules,
  }),
  bank: optionalFilter('所属银行字典数值；页面用belong_bank字典翻译标签', '用户在所属银行字典选择器选择', 'SDK发送空字符串，不限制所属银行', {
    type: 'integer', nullable: true, nullMeaning: '不按所属银行筛选',
  }),
  bankAccount: optionalFilter('银行账号筛选文本；后端按前缀匹配', '用户输入银行账号', 'SDK发送空字符串，不限制银行账号', {
    type: 'string',
  }),
  accountType: optionalFilter('账号类型字典数值；页面用receiving_account_type字典翻译标签', '用户在账号类型字典选择器选择', 'SDK发送空字符串，不限制账号类型', {
    type: 'integer', nullable: true, nullMeaning: '不按账号类型筛选',
  }),
  tenantName: optionalFilter('所属企业名称筛选文本；后端按名称前缀匹配', '仅admin用户从页面企业名称输入框提供', 'SDK发送空字符串，不限制企业名称', {
    type: 'string',
  }),
  status: optionalFilter('银行账户绝对状态：0启用、1停用', '用户选择页面状态单选项', 'SDK默认发送数值0，只查启用账户', {
    type: 'integer', options: statusOptions, constraints: ['只能是数值0或1；不是“切换”命令'],
  }),
  pageNo: optionalFilter('从1开始的页码', '调用方分页状态', 'SDK默认1', {
    type: 'integer', constraints: ['正整数'],
  }),
  pageSize: optionalFilter('当前页请求条数', '调用方分页状态', 'SDK默认20，与Portal styleV2列表一致', {
    type: 'integer', constraints: ['只能取页面支持的10、20、50、100；不接受-1全量'],
  }),
}

const createInputs: Record<string, AiParameter> = {
  organizationId: input('所属组织ID；必须来自Portal组织树', '用户在新建表单选择所属组织', { type: 'string | number', constraints: idRules }),
  corporationId: input('所属法人库ID；必须来自Portal法人选择器', '用户在新建表单选择所属法人', { type: 'string | number', constraints: idRules }),
  bank: input('所属银行字典数值；不是银行名称', '用户在belong_bank字典选择器选择', { type: 'integer' }),
  bankBranch: input('开户行名称', '用户填写新建表单开户行', { type: 'string', constraints: ['非空字符串', '最多200个字符'] }),
  accountType: input('账号类型字典数值', '用户在receiving_account_type字典选择器选择', { type: 'integer' }),
  bankAccount: input('收款银行账号；必须保持字符串以保留前导零', '用户填写新建表单收款账号', { type: 'string', constraints: ['非空字符串'] }),
  accountBusiness: input('账号业务字典数值数组', '用户在account_business多选器选择', { type: 'array', constraints: ['非空数组', '每项为整数'] }),
  accountMinimum: input('账号最小限额；页面a-input-number最小0、最多两位小数', '用户填写新建表单限额', { required: false, omitted: '按Portal表单初始值发送空字符串；显式null表示清空', nullable: true, type: 'number | string | null', constraints: ['大于等于0', '最多两位小数'] }),
  isUsed: input('限额是否可用字典数值', '用户在yes_no单选器选择；Portal默认1', { required: false, default: '1', type: 'integer', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] }),
}

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '银行账户主记录ID；用于后续启停草稿和列表回查'),
  field('list[].organizationId', 'string | number', '所属组织ID；页面筛选和组织上下文对应的实体ID', {
    nullable: true,
    nullMeaning: '后端未返回组织ID；不能用orgName反推ID',
  }),
  field('list[].corporationId', 'string | number', '所属法人库ID；用corporationOptions[].id与名称关联', {
    nullable: true,
    nullMeaning: '账户未绑定法人或后端未返回法人ID；不能用organizationId替代',
  }),
  field('list[].tenantName', 'string', '所属企业名称；页面原文显示', {
    nullable: true,
    nullMeaning: '后端未返回企业名称，页面显示为空；不据此推断当前租户',
  }),
  field('list[].orgName', 'string', '所属组织名称；页面原文显示', {
    nullable: true,
    nullMeaning: '后端未返回组织名称，页面显示为空；不据此补组织ID',
  }),
  field('list[].bank', 'integer', '所属银行字典数值；页面通过belong_bank字典显示标签', {
    nullable: true,
    nullMeaning: '未配置所属银行；不把null翻译成某个银行',
  }),
  field('list[].bankBranch', 'string', '开户行名称；页面原文显示', {
    nullable: true,
    nullMeaning: '后端未返回开户行名称，页面显示为空',
  }),
  field('list[].bankAccount', 'string', '收款银行账号；保持字符串，不能转成数字以免丢前导零', {
    nullable: true,
    nullMeaning: '后端未返回账号；不能把null当空账号已核实',
  }),
  field('list[].accountType', 'integer', '账号类型字典数值；页面通过receiving_account_type显示标签', {
    nullable: true,
    nullMeaning: '未配置账号类型；不把null翻译成某个类型',
  }),
  field('list[].accountBusiness', 'string', '账号业务字典值字符串，多个值以英文逗号分隔；页面split后通过account_business字典显示', {
    constraints: ['该字段必须是字符串，因为Portal页面直接调用split(",")；逗号分隔的每项仍是字典值，不是显示标签'],
  }),
  field('list[].accountMinimum', 'number | string', '账号最小限额；保持后端数字或十进制字符串原值，单位由页面字段语义决定', {
    nullable: true,
    nullMeaning: '未配置最小限额；不按0处理',
  }),
  field('list[].isUsed', 'integer', '限额是否可用字典值；页面通过yes_no字典显示标签', {
    nullable: true,
    nullMeaning: '后端未返回限额可用标记；不推断为可用或不可用',
  }),
  field('list[].status', 'integer', '账户绝对状态：0启用、1停用；本页显示对应状态标签', {
    values: { '0': '启用', '1': '停用' },
  }),
  field('list[].createTime', 'string | number', '账户更新时间/录入时间原值；页面调用formatDate显示，不由SDK换算时区', {
    nullable: true,
    nullMeaning: '后端未返回时间，页面显示为空',
    constraints: ['保持字符串或有限数字原值；不能把它当作状态变更时间的独立证明'],
  }),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: array, total: integer }',
  fields: [
    field('$', 'object', '当前筛选条件下的银行账户分页结果'),
    field('list', 'array', '当前页银行账户行；不是全部匹配记录'),
    field('list[]', 'object', '一条银行账户页面行；只投影页面表格和分页消费的字段'),
    ...rowFields,
    field('total', 'integer', '当前筛选条件下的总记录数；不是当前页长度', { constraints: ['非负整数；用于判断是否继续翻页'] }),
  ],
  empty: 'list=[]且total=0表示当前筛选无账户；list=[]但total>0表示当前页为空或页码超出。权限、网络或响应校验失败会抛错，不改写为空列表。',
}

const corporationOutput: AiContract['output'] = {
  shape: 'array',
  fields: [
    field('$', 'array', '当前会话租户可用法人候选数组'),
    field('[]', 'object', '一个法人候选；用于把银行账户行的corporationId映射成页面显示名称'),
    field('[].id', 'string | number', '法人库主键；与list[].corporationId属于同一法人实体命名空间', { constraints: idRules }),
    field('[].name', 'string', '法人名称；页面原文显示，不是组织名称'),
  ],
  empty: '[]表示该会话可见法人候选为空；请求失败或响应形状错误抛错，不把失败当空数组。',
}

const createOutput: AiContract['output'] = {
  shape: 'string | number',
  fields: [field('$', 'string | number', '新建银行账户主记录ID；不是组织ID、法人ID或银行账号')],
  empty: '返回缺少合法主键时抛错；不能把HTTP成功或空值当作创建成功。',
}

const preparedStatusOutput: AiContract['output'] = {
  shape: '{ draft: { id, status }, previous: { id, status } }',
  fields: [
    field('$', 'object', '启停草稿和补偿所需的当前状态快照'),
    field('draft', 'object', '提交给setStatus的目标载荷'),
    field('draft.id', 'string | number', '银行账户主记录ID'),
    field('draft.status', 'integer', '绝对目标状态：0启用、1停用', { values: { '0': '启用', '1': '停用' } }),
    field('previous', 'object', '操作前状态快照；只用于回查后需要恢复时的补偿写'),
    field('previous.id', 'string | number', '同一银行账户主记录ID'),
    field('previous.status', 'integer', '操作前绝对状态：0启用、1停用', { values: { '0': '启用', '1': '停用' } }),
  ],
  empty: '当前行、目标状态非法或目标状态与当前相同会在发请求前抛错。',
}

const statusOutput: AiContract['output'] = {
  shape: 'null',
  fields: [field('$', 'null', 'Portal enableOrStop 成功回执；不包含更新后的银行账户行', { nullable: true })],
  empty: 'Portal成功回执为null；非null响应按协议异常处理。',
}

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/menus/finance.js 与 app/portal/views/dashboard/finance/setting/receiving-account.vue',
    kind: 'reference',
    note: '证明菜单标题“银行账户”、页面路径及permission=/dashboard/finance/setting/receiving-account；本轮固定检出未按约束pull。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/receiving-account/list.vue',
    kind: 'reference',
    note: '证明platform实例、getDataListURL、分页表单默认值、表格消费字段、法人支撑GET、页面筛选以及创建/启停按钮和按钮权限；写请求路径另由同页表单和Java Controller交叉核对。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 common/libs/renren/list.js 与 app/portal/main.js',
    kind: 'reference',
    note: '证明列表请求键序为order、orderField、表单字段、pageNo、pageSize，门户默认分页参数名为pageSize；不等于浏览器网络基准。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 ReceivingAccountNumberController/ReceivingAccountNumberPageReqVO/ReceivingAccountNumberRespVO/Mapper.xml',
    kind: 'reference',
    note: '证明分页、创建、启停路径，保存字段类型、分页返回list/total、页面行字段和法人GET支撑接口；固定检出未pull，不能替代部署环境响应验证。',
  },
  {
    source: 'src/capabilities/finance-setting-receiving-account.ts',
    kind: 'implementation',
    note: '证明SDK实现列表、法人候选、新建草稿/提交和启停草稿/提交的请求载荷、moduleType=null上下文及严格字段校验；不替代Portal/Java源码版本或真实环境验证。',
  },
  {
    source: 'test/finance-setting-receiving-account.test.ts',
    kind: 'test',
    note: '离线request stub锁定列表筛选、分页、字段投影、法人支撑响应、创建/启停请求、权限/模块上下文及AI契约反证；测试不发真实网络。',
  },
]

const boundaries = [
  '覆盖菜单“财务设置→银行账户”列表分页、法人名称支撑读取、列表页新建和列表页启停；页面没有编辑按钮，因此不发布后端虽存在的get/update编辑接口，也不覆盖导出或其它页面调用的银行账户接口。',
  '新建严格复现Portal表单实际发送字段和初始值；accountBusiness是非空整数数组，响应行accountBusiness仍是页面直接split的逗号字符串，accountMinimum遵循最小0和两位小数。',
  '新建需要finance:setting:receiving-account:create，启停需要finance:setting:receiving-account:status；SDK只能表达请求和校验，服务端仍会按会话权限及银行字典/科目映射校验。',
  '页面目录moduleType=null，SDK与Portal规则一致不发送module-type；列表和法人支撑请求都使用platform HTTP实例，调用方仍须用会话token与tenantId绑定一个用户/租户实例。',
  '列表仅接受页面实际表单字段和分页字段；后端VO中的businessType、orgIds、includeCurrentOrgAndParents、createTime等未由本页表单发送的参数不扩展为本能力输入。',
  '字典值只返回原始数值/逗号字符串；belong_bank、receiving_account_type、account_business、yes_no的显示标签来自Portal运行时字典，本能力不猜字典枚举含义。',
  '启停接口是GET查询参数{id,status}且成功回执为null；它不是PUT body，也不是无条件toggle。',
]

const failures = [
  '筛选ID、字典值、状态或分页参数不合法时不会发请求；按字段修正后重试。',
  '列表缺少有效list/total、行ID非法、accountBusiness不是字符串或字段类型不符合页面消费时抛错，不改写为空列表；先核对部署响应形状。',
  '法人支撑响应不是数组或包含data数组、候选缺少合法id/name时抛错；不能用corporationId直接当法人名称，也不能用组织名称替代法人名称。',
  '新建表单字段缺失、bankBranch超过200个字符、accountBusiness为空/含非整数、accountMinimum为负数或超过两位小数、isUsed不是0/1时发请求前抛错。',
  '启停目标状态与当前状态相同、ID或状态非法时发请求前抛错；Portal回执不是null时按协议异常处理。',
  '401/403、网络错误或后端业务错误原样抛出；只读查询恢复会话/权限后可重试，失败不表示当前没有账户或法人。',
]

function contract (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract {
  return {
    whenToUse: '操作Portal“财务设置→银行账户”列表页，包括分页读取、法人名称映射、新建和启停；不用于编辑或删除银行账户。',
    boundaries,
    prerequisites: [
      '已建立带有效会话token和tenantId的SDK；一个platform HTTP实例只绑定一个用户和租户。',
      '需要解释corporationId时，应同时读取corporationOptions，并按同一法人库ID关联，不凭名称猜ID；新建时组织和法人ID必须来自页面候选。',
    ],
    failures,
    evidence,
    gaps: [
      '本轮未启动浏览器，未取得该页面独立网络基准、真实请求序列、响应空值变体或真实权限结果；请求和字段语义来自固定Portal/Java源码与离线夹具。',
      'Portal前端固定检出d3cf56bdc7、Java固定检出dcb3f360194均未按本代理禁令pull到远端最新；不能把当前静态锚点称为最新部署证据。',
      '未在真实测试环境执行任何读冒烟，也未验证法人接口的实际部署响应包络、字典标签和当前账号可见数据；因此未验证真实返回字段类型与权限效果。',
      '创建没有页面提供的可逆取消接口；创建后只能用列表回查确认，清理需要部署方受控运维。启停可用previous草稿对同一GET接口做补偿写，但不是事务回滚。',
    ],
    ...value,
  }
}

export const FINANCE_SETTING_RECEIVING_ACCOUNT_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-receiving-account-list': contract({
    purpose: '按页面筛选条件分页读取银行账户表格，返回所属企业、组织、法人ID、银行、账号、业务、限额和状态等页面消费字段。',
    effect: 'read',
    inputs: listInputs,
    output: pageOutput,
    consume: [
      '展示list当前页字段；按total判断是否继续递增pageNo，不能把当前页长度当作完整结果。',
      '用list[].corporationId在financeSettingReceivingAccount.corporationOptions返回的[].id中查找法人名称；找不到时保留ID或空显示，不把ID当名称。',
      '按字典原值解释bank、accountType、accountBusiness和isUsed；accountBusiness先按英文逗号分隔，再逐项交给account_business字典，不能把代码直接当中文标签。',
      'status只作为查询结果的启用/停用事实展示；本能力不提供状态改变动作，列表读取成功不代表任何写入已经发生。',
    ],
    steps: [
      {
        role: 'optional',
        when: '列表存在corporationId且用户需要显示所属法人名称',
        capabilityId: 'finance-setting-receiving-account-corporation-options',
        mapping: {},
        instruction: '读取法人候选后按法人库ID精确关联；不要按名称模糊匹配，也不要把organizationId当corporationId。',
      },
      {
        role: 'optional',
        when: '用户要按已选法人继续收窄银行账户列表',
        capabilityId: 'finance-setting-receiving-account-list',
        mapping: { corporationId: 'result.list[].corporationId' },
        instruction: '只把用户选定行的法人库ID作为下一次list的corporationId；不要把法人名称或organizationId传入。',
      },
      {
        role: 'required',
        when: '用户明确要新建银行账户',
        capabilityId: 'finance-setting-receiving-account-prepare-create',
        mapping: {},
        instruction: '先按页面表单规则准备完整草稿，再由用户确认后调用create；organizationId和corporationId必须来自当前候选。',
      },
      {
        role: 'optional',
        when: '用户明确要改变某一行的启用状态',
        capabilityId: 'finance-setting-receiving-account-prepare-set-status',
        mapping: { current: 'result.list[]', targetStatus: 'user.targetStatus' },
        instruction: '只选一条最新列表行，targetStatus必须是与当前status相反的绝对值；不要从状态文字猜数值。',
      },
    ],
    completion: '已取得当前筛选条件和页码对应的list/total；需要完整结果时须继续翻页到累计达到total或返回空页。列表本身不改变账户，写入必须继续走对应草稿和提交能力。',
    idempotency: null,
  }),

  'finance-setting-receiving-account-corporation-options': contract({
    purpose: '读取当前会话可见的法人候选，用于把银行账户列表的corporationId显示为法人名称。',
    effect: 'read',
    inputs: {},
    output: corporationOutput,
    consume: [
      '把[].id作为法人库ID与银行账户列表的corporationId精确关联；把[].name作为显示文本。',
      '候选列表为空或某个账户ID没有匹配项时，不根据organizationId、tenantName或名称相似度补造法人关系。',
    ],
    steps: [],
    completion: '已取得一次法人候选快照；它只用于本次显示映射，不证明银行账户存在、启用或可被写入。',
    idempotency: null,
  }),

  'finance-setting-receiving-account-prepare-create': contract({
    purpose: '按Portal银行账户新建表单的字段、默认值和校验规则生成完整创建载荷，不发请求。',
    effect: 'prepare',
    inputs: createInputs,
    output: {
      shape: '{ draft: object }',
      fields: [
        field('$', 'object', '创建草稿容器'),
        field('draft', 'object', 'POST create实际发送的保存字段'),
        field('draft.organizationId', 'string | number', '所属组织ID'),
        field('draft.corporationId', 'string | number', '所属法人库ID'),
        field('draft.bank', 'integer', '所属银行字典值'),
        field('draft.bankBranch', 'string', '开户行名称'),
        field('draft.accountType', 'integer', '账号类型字典值'),
        field('draft.bankAccount', 'string', '收款银行账号；保留字符串'),
        field('draft.accountBusiness', 'array', '非空账号业务字典整数数组'),
        field('draft.accountMinimum', 'number | string | null', '最小限额；省略输入时保留Portal初始空字符串', { nullable: true }),
        field('draft.isUsed', 'integer', '限额是否可用；Portal默认1', { values: { '0': '否', '1': '是' } }),
      ],
      empty: '输入不完整或违反Portal表单规则时抛错，不返回半成品草稿。',
    },
    consume: ['向用户展示并确认草稿中的组织、法人、字典值和账号字符串；不能把名称写入ID字段。', '确认后把result.draft原样交给create，不手工删除accountMinimum或isUsed。'],
    steps: [{ role: 'required', when: '用户确认创建草稿', capabilityId: 'finance-setting-receiving-account-create', mapping: { organizationId: 'result.draft.organizationId', corporationId: 'result.draft.corporationId', bank: 'result.draft.bank', bankBranch: 'result.draft.bankBranch', accountType: 'result.draft.accountType', bankAccount: 'result.draft.bankAccount', accountBusiness: 'result.draft.accountBusiness', accountMinimum: 'result.draft.accountMinimum', isUsed: 'result.draft.isUsed' }, instruction: '提交完整草稿；创建接口没有页面可逆取消接口。' }],
    completion: '仅生成本地创建载荷，尚未产生银行账户记录。',
    idempotency: null,
  }),

  'finance-setting-receiving-account-create': contract({
    purpose: '提交Portal银行账户新建表单，创建一条收款银行账户记录并返回后端分配的主键。',
    effect: 'write',
    inputs: createInputs,
    output: createOutput,
    consume: ['返回值是新记录ID；它不是银行账号或法人ID。', '创建成功或超时后，用list按组织、法人、银行账号和其它字段回查并按ID核对；只凭HTTP成功不能报告已落库。'],
    steps: [
      { role: 'required', when: 'create返回ID或请求超时，需要确认最终状态', capabilityId: 'finance-setting-receiving-account-list', mapping: { organizationId: 'args.organizationId', corporationId: 'args.corporationId', bankAccount: 'args.bankAccount' }, instruction: '分页读取并精确匹配同一ID及保存字段；找不到时结果不确定。' },
      { role: 'cancel', when: '用户要求撤销已创建银行账户', instruction: '本页面没有删除、停用即撤销或其它可逆创建接口；不要伪造cancel调用，需交给部署方受控运维清理。' },
    ],
    completion: '只有返回合法ID并由list回查同一ID字段一致，才能报告创建已核实；不会自动报告账户已启用以外的业务效果。',
    idempotency: '后端创建接口没有requestId或SDK幂等键；超时可能已经创建，必须先按ID/字段回查，未核实前不要重复create。',
  }),

  'finance-setting-receiving-account-prepare-set-status': contract({
    purpose: '基于最新银行账户列表行生成Portal启停接口需要的{ id, status }绝对状态草稿，并保留previous用于补偿写。',
    effect: 'prepare',
    inputs: {
      current: input('最新银行账户列表行；至少含id和status。', '同一次finance-setting-receiving-account-list结果中的list[]', { type: 'object' }),
      targetStatus: input('绝对目标状态：0启用、1停用，且必须与current.status相反。', '用户明确的启用/停用意图', { type: 'integer', options: statusOptions }),
    },
    output: preparedStatusOutput,
    consume: ['将result.draft原样交给setStatus；不要把状态动作改成PUT body或无条件toggle。', '保留result.previous；目标状态回查成功后，用户明确要求恢复时可把previous作为补偿草稿再次提交。'],
    steps: [{ role: 'required', when: '用户确认目标状态且草稿来自最新列表行', capabilityId: 'finance-setting-receiving-account-set-status', mapping: { draft: 'result.draft' }, instruction: '按页面状态按钮权限提交绝对状态。' }],
    completion: '仅生成启停载荷，尚未改变银行账户状态。',
    idempotency: null,
  }),

  'finance-setting-receiving-account-set-status': contract({
    purpose: '复现Portal列表状态按钮，通过GET查询参数把一条银行账户写成明确的启用或停用状态。',
    effect: 'write',
    inputs: { draft: input('prepareSetStatus返回的{ id, status }启停草稿。', 'finance-setting-receiving-account-prepare-set-status.result.draft', { type: 'object' }) },
    output: statusOutput,
    consume: ['Portal成功回执为null；成功或超时后必须用list按同一ID回查status。', '若用户明确要求恢复且目标值已回查，使用prepare结果中的previous作为补偿写；这不是事务回滚。'],
    steps: [
      { role: 'required', when: 'GET返回null或请求超时，需要确认状态终态', capabilityId: 'finance-setting-receiving-account-list', mapping: { organizationId: 'user.organizationId' }, instruction: '按可用筛选分页定位同一id并核对status；不能只凭空回执或状态文字确认。' },
      { role: 'cancel', when: '目标状态已回查且用户明确要求恢复，同时仍保存previous草稿', capabilityId: 'finance-setting-receiving-account-set-status', mapping: { draft: 'context.previous' }, instruction: '提交previous作为同一接口的补偿写；先核对当前状态仍是目标状态，避免覆盖并发变更。' },
    ],
    completion: 'GET返回null只表示接口成功回执；列表回查同一ID的status等于目标值后，才能报告启停已核实。',
    idempotency: '后端没有requestId或幂等键；重复的绝对状态可能覆盖并发变更。超时先回查再决定是否重试。',
  }),
}

export const FINANCE_SETTING_RECEIVING_ACCOUNT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_RECEIVING_ACCOUNT_METHODS).map(([capabilityId, method]) => {
    const source = FINANCE_SETTING_RECEIVING_ACCOUNT_AI_CONTRACTS[capabilityId]!
    const methodPath = 'financeSettingReceivingAccount.' + method
    return [methodPath, {
      ...source,
      boundaries: [...source.boundaries, '公开方法 ' + methodPath + ' 接受单个对象参数；' + (method === 'list' ? 'list可省略对象，字段与inputs一致。' : '无业务参数，传入对象字段不会扩展后端请求。')],
    }]
  }),
)
