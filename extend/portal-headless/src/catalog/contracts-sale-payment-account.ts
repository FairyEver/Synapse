import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALE_PAYMENT_ACCOUNT_METHODS } from '../capabilities/sale-payment-account.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const pagePath = '/dashboard/sale/order/payment-account/list'
const pagePermission = '/dashboard/sale/frame/order/payment-account'
const createPermission = 'sale:order:payment-account:create'
const editPermission = 'sale:order:payment-account:edit'
const deletePermission = 'sale:order:payment-account:delete'

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '收款账号记录主键；编辑、详情和删除均使用，必须来自当前列表。'),
  field('list[].officeId', 'string | number | null', '所属销售组织ID；详情表单的officeId，不能用officeName代替。', { nullable: true }),
  field('list[].officeName', 'string | null', '列表展示的公司名称；只读，不能当officeId提交。', { nullable: true }),
  field('list[].itemName', 'string | null', '后端按品类ID补出的品类名称；列表当前不展示itemKind原始值。', { nullable: true }),
  field('list[].itemKind', 'string | null', '逗号分隔的品类ID字符串；详情页会split成itemKindCode，不能提交品类名称。', { nullable: true }),
  field('list[].bankName', 'string | null', '开户行名称；表单必填。', { nullable: true }),
  field('list[].receiptAccountName', 'string | null', '收款银行账户名称；表单必填。', { nullable: true }),
  field('list[].receiptAccountNo', 'string | null', '收款银行账号；保持字符串，表单必填。', { nullable: true }),
  field('list[].merchantCode', 'string | null', '善付通商户号；表单可空。', { nullable: true }),
  field('list[].branchName', 'string | null', '支行名称；表单可空。', { nullable: true }),
  field('list[].instCode', 'string | null', '总行联行号；表单可空。', { nullable: true }),
  field('list[].branchInstCode', 'string | null', '开户行联行号；表单可空。', { nullable: true }),
  field('list[].publicKey', 'string | null', '善付通密钥；表单可空。', { nullable: true }),
  field('list[].creator', 'string | number | null', '创建者ID原值；当前页面不展示。', { nullable: true }),
  field('list[].createTime', 'string | number | null', '创建时间原值；当前页面不展示。', { nullable: true }),
  field('list[].updater', 'string | number | null', '更新者ID原值；当前页面只展示updaterName。', { nullable: true }),
  field('list[].updaterName', 'string | null', '最后更新人姓名；列表展示字段。', { nullable: true }),
  field('list[].updateTime', 'string | number | null', '最后更新时间；列表展示字段。', { nullable: true }),
  field('list[].deleted', 'boolean | null', '后端删除标记原值；页面不把它当作业务状态。', { nullable: true }),
  field('list[].tenantId', 'string | number | null', '租户ID原值；SDK不接受调用方伪造租户。', { nullable: true }),
]

const detailFields: AiField[] = [
  ...rowFields.map(item => ({ ...item, path: item.path.replace(/^list\[\]\.?/, '') })),
  field('itemKindCode', 'string[]', '详情页把itemKind按逗号拆分后的品类ID数组；提交时会重新join为itemKind。'),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '收款账号分页结果；Portal分页响应的total保留为total。'),
    field('list', 'object[]', '当前页记录，不是全量结果。'),
    field('total', 'number', '符合条件的记录总数，用于分页；不能用list.length代替。'),
    ...rowFields,
  ],
  empty: 'list=[]表示当前页没有记录；total=0才表示当前查询无记录，权限或网络失败会抛错。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: detailFields,
  empty: '详情不存在或响应缺字段时抛错；不会把不存在的记录伪造成空表单。',
}

const organizationOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '销售组织树节点；页面TreeSelect使用id作为value/key、name作为展示文本。'),
    field('[].id', 'string | number', '销售组织节点ID；提交到officeId。'),
    field('[].name', 'string', '销售组织名称；只展示，不提交为ID。'),
    field('[].salesType', 'number | null', '销售组织类型原值；页面仅允许salesType为0或1的节点可选。', { nullable: true }),
    field('[].disabled', 'boolean', '页面根据!([0,1].includes(Number(salesType)))计算的不可选标记。'),
    field('[].children', 'object[]', '子组织节点，结构同当前节点。'),
  ],
  empty: '返回空数组表示当前权限范围没有可见组织；组织树请求失败会抛错。',
}

const categoryOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', 'Portal品类树原始节点；页面实际只把顶层catId/catName映射成Select options。'),
    field('[].catId', 'string | number', '品类ID；提交时进入itemKindCode。'),
    field('[].catName', 'string', '品类展示名称；不能代替提交值。'),
    field('[].level', 'string | null', '品类层级原值。', { nullable: true }),
    field('[].lv2', 'object[]', '二级品类节点；当前页面不会自动展开为额外options。'),
    field('[].lv2[].lv3', 'object[]', '三级品类节点；结构保留供解释，页面Select仍只使用顶层映射。'),
  ],
  empty: '返回空数组表示品类接口没有返回候选；不要自行猜测itemKindCode。',
}

const bankBranchOutput: AiContract['output'] = {
  shape: 'string[]',
  fields: [field('[]', 'string', '当前公司下去重后的开户行名称；是bankList的bankBranch输入。')],
  empty: '未选择公司时Portal直接返回空数组且不发请求；有公司但无候选时也是空数组。',
}

const bankOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('[]', 'object', '银行候选。'), field('[].bank', 'number | null', '银行编码；后续bankAccountList的bank参数。', { nullable: true }), field('[].bankName', 'string | null', '银行展示名称。', { nullable: true })],
  empty: '未同时提供公司和开户行时Portal不发请求并返回空数组；后端无候选时也返回空数组。',
}

const bankAccountOutput: AiContract['output'] = {
  shape: 'string[]',
  fields: [field('[]', 'string', '按公司、银行编码和开户行过滤后的去重收款账号；只作为候选，不等于已保存记录。')],
  empty: '缺少任一前置值时Portal不发请求并返回空数组；后端无候选时也是空数组。',
}

const formFields: AiField[] = [
  field('form', 'object', 'Portal收款账号详情页表单；SDK只提取页面customSubmit实际发送的字段。'),
  field('form.id', 'string | number', '编辑时的当前记录ID；新建时省略或为空。', { optional: true, nullable: true }),
  field('form.officeId', 'string | number', '所属公司ID；组织树节点id，必填。'),
  field('form.itemKindCode', 'string[] | number[]', '品类ID数组；品类树候选中选择至少一项，提交时转换为逗号分隔itemKind。'),
  field('form.merchantCode', 'string', '善付通商户号；可空，默认空字符串。'),
  field('form.receiptAccountName', 'string', '收款银行账户名称；必填。'),
  field('form.bankName', 'string', '开户行名称；必填；租户系统类型为2时可从候选中选择或手工输入。'),
  field('form.receiptAccountNo', 'string', '收款银行账号；必填；保持字符串。'),
  field('form.instCode', 'string', '总行联行号；可空，默认空字符串。'),
  field('form.branchName', 'string', '支行名称；可空，默认空字符串。'),
  field('form.branchInstCode', 'string', '开户行联行号；可空，默认空字符串。'),
  field('form.publicKey', 'string', '善付通密钥；可空，默认空字符串。'),
  field('form.office', 'object | null', '组织树展示快照；页面提交时明确omit，不要依赖它替代officeId。', { optional: true, nullable: true }),
  field('form.createDate', 'string | number | null', '详情/列表时间字段；页面提交时omit。', { optional: true, nullable: true }),
  field('form.updateDate', 'string | number | null', '详情/列表时间字段；页面提交时omit。', { optional: true, nullable: true }),
]

const createDraftFields: AiField[] = [
  field('draft', 'object', '新建POST请求体；不含id、office、createDate、updateDate、itemKindCode。'),
  field('draft.officeId', 'string | number', '所属公司ID。'),
  field('draft.itemKind', 'string', 'itemKindCode各项转成字符串后用逗号join的结果，例如["1","2"]→"1,2"。'),
  field('draft.merchantCode', 'string', '商户号；空值按空字符串发送。'),
  field('draft.receiptAccountName', 'string', '收款银行账户名称。'),
  field('draft.bankName', 'string', '开户行名称。'),
  field('draft.receiptAccountNo', 'string', '收款银行账号字符串。'),
  field('draft.instCode', 'string', '总行联行号。'),
  field('draft.branchName', 'string', '支行名称。'),
  field('draft.branchInstCode', 'string', '开户行联行号。'),
  field('draft.publicKey', 'string', '密钥。'),
]

const updateDraftFields = [...createDraftFields, field('draft.id', 'string | number', '当前已有收款账号记录ID；PUT必须携带。')]
const createOutput: AiContract['output'] = { shape: 'string | number', fields: [field('$', 'string | number', '后端创建成功返回的新收款账号ID。')], empty: '创建响应缺少有效ID时抛错；不能把空回执当成成功。' }
const preparedCreateOutput: AiContract['output'] = { shape: '{ draft: object }', fields: createDraftFields, empty: '表单校验失败时准备阶段抛错且不发送POST；成功只代表本地草稿已整理。' }
const preparedUpdateOutput: AiContract['output'] = { shape: '{ draft: object }', fields: updateDraftFields, empty: '表单校验失败时准备阶段抛错且不发送PUT；成功只代表本地草稿已整理。' }
const voidOutput: AiContract['output'] = { shape: 'undefined', fields: [field('$', 'undefined', '更新和删除成功回执是布尔值；SDK先校验为true后返回undefined。')], empty: '响应不是true时抛错；Promise完成只代表后端接受请求，必须回查。' }
const removeOutput: AiContract['output'] = { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待删除的当前列表记录ID。')], empty: 'ID非法时准备阶段抛错且不发送DELETE。' }

const formInput = param('Portal收款账号编辑页完整表单。', '用户输入、当前列表行与sale-payment-account-get详情；编辑必须保留当前id', {
  type: 'object',
  required: true,
  constraints: [
    'officeId、itemKindCode、receiptAccountName、bankName、receiptAccountNo为页面required字段；itemKindCode至少选择一项。',
    'merchantCode、instCode、branchName、branchInstCode、publicKey可空，缺省按空字符串提交；页面没有长度、格式或数值范围校验，SDK不新增限制。',
    '新建请求体删除id；编辑请求体必须带当前id；office、createDate、updateDate和itemKindCode不直接发给后端。',
  ],
})
const createDraftInput = param('prepareCreate返回的完整新建草稿。', 'sale-payment-account-prepare-create.result.draft', { type: 'object', required: true, constraints: ['保持itemKind的逗号字符串和所有页面字段，不要重新传itemKindCode或id。'] })
const updateDraftInput = param('prepareUpdate返回的完整编辑草稿。', 'sale-payment-account-prepare-update.result.draft', { type: 'object', required: true, constraints: ['必须保留当前id；保持itemKind的逗号字符串和所有页面字段。'] })
const idInput = param('当前列表选中的收款账号ID。', 'sale-payment-account-list.list[].id，由用户明确选择', { type: 'string | number', required: true, constraints: ['必须来自当前列表或get结果；不能用officeId、账号或商户号猜测。'] })
const gaps = ['尚未在真实测试环境执行本页组织树、品类树、银行级联、列表、详情、新建、编辑、删除及写入后的回查；当前证据来自Portal源码、销售/CRM Java源码与离线请求断言。']

function base (purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      `只覆盖门户系统设置/销售设置下的“收款账号”页面${pagePath}；不是相邻的“SAP-收款账号”旧CRM页面，也不是财务系统收款账户菜单。`,
      `页面菜单权限是${pagePermission}；新建、编辑、删除按钮分别检查${createPermission}、${editPermission}、${deletePermission}。SDK不绕过前端或后端权限。`,
      '列表、详情、组织树、银行级联使用Portal platform实例（VITE_ZHDJ_PLATFORM_API）；品类候选明确使用platform-mall-admin实例（VITE_MALL_ADMIN_API），不能把两个实例合并。页面module-type=60。',
      '列表没有筛选表单、排序控件或导出入口，但公共列表仍发送order、orderField的空字符串；只暴露页面实际使用的分页字段。',
      '编辑页是隐藏动态路由，打开时先GET详情，再按officeId、bankName、receiptAccountName级联加载候选；写入前必须执行prepare并等待用户确认。',
    ],
    effect,
    prerequisites: ['使用带会话token、tenantId、平台与平台商城管理端base URL的SDK；写操作的表单和ID必须来自用户明确输入/选择。'],
    inputs: {},
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? 'Promise完成只表示请求通过响应校验；新建、编辑、删除完成或超时后必须重新list/get核对，不能只看HTTP成功。' : '返回通过结构校验的页面数据或无副作用的准备草稿。',
    failures: ['非法表单、ID、分页或响应形状在本地失败；权限、租户、网络和后端业务错误原样抛出。', '级联前置值缺失时按Portal返回空数组且不发请求；不能用空候选掩盖有前置值时的上游错误。'],
    idempotency: effect === 'write' ? '创建接口没有requestId幂等契约；创建、更新或删除超时先回查，不盲目重发。' : null,
    evidence: [
      { source: 'CodeReview_Projects_Js@test/portal/main: app/portal/menus/sale.js:203、app/portal/views/dashboard/sale/order/payment-account/list.vue、[mode]/[id].vue、app/portal/main.js、common/libs/renren/list.js', kind: 'reference', note: '证明页面路径、按钮权限、分页空参数、隐藏详情页、表单校验、请求实例、字段联动和提交转换。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-sales/.../SalesCcbAccountController.java、SalesCcbAccountSaveReqVO.java、SalesCcbAccountRespVO.java、SalesCcbAccountServiceImpl.java、SalesCcbAccountMapper.xml', kind: 'reference', note: '证明销售收款账号CRUD路由、后端必填字段、返回ID/true、租户隔离和额外展示字段。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: SalesOrganizationController.java、ManualOrderController.java、ManualOrderMapper.xml、ManageSyscategoryCatController.java、ManageSyscategoryCatServiceImpl.java', kind: 'reference', note: '证明组织树、银行级联和品类树支撑接口及其字段。' },
      { source: 'src/capabilities/sale-payment-account.ts 与 test/sale-payment-account.test.ts', kind: 'test', note: '锁定请求实例、路径、分页、级联前置短路、表单转换、返回校验、权限元数据和负例；不替代真实环境验证。' },
      { source: 'docs/pages/收款账号.md', kind: 'reference', note: '记录本页四件套和真实环境缺口。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'sale-payment-account-list': {
    ...base('分页查询当前用户和租户可见的收款账号列表。', listOutput, ['列表展示officeName、itemName、merchantCode、receiptAccountNo、updateTime、updaterName；total只用于翻页。', '编辑或删除前保留目标行id；编辑详情使用get，不把列表展示名称当作提交ID。']),
    inputs: {
      order: param('Portal公共列表排序值。', 'useListPageModule公共状态；页面没有排序控件', { type: 'string', required: false, default: '空字符串', omitted: 'SDK发送空字符串，不代表页面提供排序交互' }),
      orderField: param('Portal公共列表排序字段。', 'useListPageModule公共状态；页面没有排序控件', { type: 'string', required: false, default: '空字符串', omitted: 'SDK发送空字符串，不代表页面提供排序交互' }),
      pageNo: param('从1开始的页码。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认1' }),
      pageSize: param('每页条数。', '调用方分页状态；Portal styleV2默认20', { type: 'integer', required: false, default: 'SDK默认20', constraints: ['接受10/20/50/100。'] }),
    },
  },
  'sale-payment-account-organization-tree': {
    ...base('读取收款账号表单的销售组织树。', organizationOutput, ['选择disabled=false节点的id填入form.officeId；节点name只用于展示。', '组织树请求固定携带salesTypeMax="1"；不要把SAP页面使用的salesId字段混到本页。']),
  },
  'sale-payment-account-category-tree': {
    ...base('读取收款账号表单的销售品类树。', categoryOutput, ['页面只把顶层catId/catName映射为Select的value/label；提交value数组，不提交名称。', '品类接口来自platform-mall-admin，不是本页列表的platform实例。']),
  },
  'sale-payment-account-bank-branch-list': {
    ...base('按已选择的公司读取可选开户行名称。', bankBranchOutput, ['公司变化时清空bankName、receiptAccountName、receiptAccountNo，再重新加载该列表。'], 'read'),
    inputs: { organizationId: param('销售组织ID。', 'sale-payment-account-organization-tree.[].id，由用户选择', { type: 'string | number', required: false, constraints: ['为空时完全复刻Portal：返回[]且不发请求。'] }) },
  },
  'sale-payment-account-bank-list': {
    ...base('按公司和开户行读取银行候选。', bankOutput, ['从返回的bank作为bankAccountList.bank，从bankName作为展示文本；更换开户行时清空账户名和收款账号。'], 'read'),
    inputs: {
      organizationId: param('销售组织ID。', 'sale-payment-account-organization-tree.[].id，由用户选择', { type: 'string | number', required: false, constraints: ['为空时返回[]且不发请求。'] }),
      bankBranch: param('开户行名称。', '用户选择或手工输入；页面字段form.bankName', { type: 'string', required: false, constraints: ['为空时返回[]且不发请求。'] }),
    },
  },
  'sale-payment-account-bank-account-list': {
    ...base('按公司、银行编码和开户行读取收款账号候选。', bankAccountOutput, ['只有三个前置值都有值时请求；选择账户名后把候选写回form.receiptAccountNo。'], 'read'),
    inputs: {
      organizationId: param('销售组织ID。', 'sale-payment-account-organization-tree.[].id，由用户选择', { type: 'string | number', required: false }),
      bank: param('银行编码。', 'sale-payment-account-bank-list.[].bank，由用户选择', { type: 'string | number', required: false }),
      bankBranch: param('开户行名称。', 'sale-payment-account-bank-list调用时使用的bankBranch', { type: 'string', required: false }),
    },
  },
  'sale-payment-account-get': {
    ...base('读取编辑页当前收款账号详情并生成itemKindCode回显数组。', detailOutput, ['打开编辑页先用详情的officeId加载开户行；有bankName再加载银行；有receiptAccountName再按对应bank加载收款账号候选。', 'itemKindCode来自itemKind按逗号split的ID数组，不能把itemName或bankName当作品类ID。']),
    inputs: { id: idInput },
    steps: [
      { role: 'optional', when: '详情officeId存在', capabilityId: 'sale-payment-account-bank-branch-list', mapping: { organizationId: 'result.officeId' }, instruction: '加载开户行候选。' },
      { role: 'optional', when: '详情officeId和bankName都存在', capabilityId: 'sale-payment-account-bank-list', mapping: { organizationId: 'result.officeId', bankBranch: 'result.bankName' }, instruction: '加载银行候选并寻找bank。' },
      { role: 'optional', when: '详情的银行账户名和银行候选bank都存在', capabilityId: 'sale-payment-account-bank-account-list', mapping: { organizationId: 'result.officeId', bank: 'user.bankOptions[].bank', bankBranch: 'result.bankName' }, instruction: '加载收款账号候选；bank来自前一步选中的银行候选，候选仅用于回显和选择，不替代详情字段。' },
    ],
  },
  'sale-payment-account-prepare-create': {
    ...base('按收款账号页面规则整理新建表单，不发送create。', preparedCreateOutput, ['先取得组织树和品类树；用户取消时丢弃result.draft，确认后把同一draft交给create。'], 'prepare'),
    inputs: { form: formInput },
    steps: [
      { role: 'required', when: '准备新建表单前', capabilityId: 'sale-payment-account-organization-tree', mapping: {}, instruction: '选择可用组织节点的id填入officeId。' },
      { role: 'required', when: '准备新建表单前', capabilityId: 'sale-payment-account-category-tree', mapping: {}, instruction: '从品类候选取得itemKindCode值。' },
      { role: 'required', when: '用户明确确认新建', capabilityId: 'sale-payment-account-create', mapping: { draft: 'result.draft' }, instruction: '提交同一份草稿；不要把原始itemKindCode、office或id放回请求。' },
      { role: 'cancel', when: '用户取消新建', instruction: '只丢弃本地草稿，不发送create。' },
    ],
  },
  'sale-payment-account-create': {
    ...base('创建一条用户确认的收款账号记录。', createOutput, ['创建成功返回新ID；保存成功或超时后按返回ID调用get并用list确认列表展示字段。'], 'write'),
    inputs: { draft: createDraftInput },
    steps: [{ role: 'recovery', when: '创建成功、超时或响应丢失后核实结果', capabilityId: 'sale-payment-account-get', mapping: { id: 'result.$' }, instruction: '用返回的新ID读取详情，再按需要list核对，不能只看HTTP成功。' }],
  },
  'sale-payment-account-prepare-update': {
    ...base('按收款账号页面规则整理当前详情的完整编辑表单，不发送update。', preparedUpdateOutput, ['先调用get并保留当前id；用户取消时丢弃result.draft，确认后把同一draft交给update。'], 'prepare'),
    inputs: { form: formInput },
    steps: [
      { role: 'required', when: '编辑当前记录前', capabilityId: 'sale-payment-account-get', mapping: { id: 'user.form.id' }, instruction: '读取详情并生成itemKindCode，再补齐级联候选。' },
      { role: 'required', when: '用户明确确认编辑', capabilityId: 'sale-payment-account-update', mapping: { draft: 'result.draft' }, instruction: '提交同一份含当前id的完整草稿。' },
      { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃本地草稿，不发送update。' },
    ],
  },
  'sale-payment-account-update': {
    ...base('按用户确认的完整表单更新一条收款账号记录。', voidOutput, ['页面使用PUT并要求完整字段；成功或超时后按draft.id调用get逐字段核对。'], 'write'),
    inputs: { draft: updateDraftInput },
    steps: [{ role: 'recovery', when: '编辑成功、超时或响应丢失后核实结果', capabilityId: 'sale-payment-account-get', mapping: { id: 'user.draft.id' }, instruction: '读取同一ID核对所有页面字段；找不到或冲突不能报告已完成。' }],
  },
  'sale-payment-account-prepare-remove': {
    ...base('准备删除当前列表选定的一条收款账号记录。', removeOutput, ['展示目标公司、商户号、收款账号并等待确认；取消时只丢弃result.id。'], 'prepare'),
    inputs: { id: idInput },
    steps: [
      { role: 'required', when: '用户明确确认删除', capabilityId: 'sale-payment-account-remove', mapping: { id: 'result.id' }, instruction: '提交同一当前列表记录ID。' },
      { role: 'cancel', when: '用户取消删除', instruction: '只丢弃删除草稿，不发送DELETE。' },
    ],
  },
  'sale-payment-account-remove': {
    ...base('删除当前列表选定的一条收款账号记录。', voidOutput, ['页面只支持单条删除；成功或超时后重新list确认目标ID消失。'], 'write'),
    inputs: { id: idInput },
    steps: [{ role: 'recovery', when: '删除成功、超时或响应丢失后核实结果', capabilityId: 'sale-payment-account-list', mapping: {}, instruction: '分页查询并确认目标ID不再出现；超时先核实再决定是否重试。' }],
  },
}

export const SALE_PAYMENT_ACCOUNT_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALE_PAYMENT_ACCOUNT_METHODS).map(id => [id, contracts[id]!]))
export const SALE_PAYMENT_ACCOUNT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALE_PAYMENT_ACCOUNT_METHODS).map(([id, method]) => [`salePaymentAccount.${method}`, SALE_PAYMENT_ACCOUNT_AI_CONTRACTS[id]!]))
