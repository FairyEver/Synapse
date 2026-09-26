import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALE_CCB_ACCOUNT_METHODS } from '../capabilities/sale-ccb-account.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const pagePath = '/dashboard/sale/order/ccb-account/list'
const pagePermission = '/dashboard/sale/frame/order/ccb-account'
const createPermission = 'order:ccbAccount:edit'
const rowActionPermission = 'order:tradeStoreroom:edit'

const rowFields: AiField[] = [
  field('list[].id', 'string | number | null', 'SAP收款账号记录主键；删除时使用', { nullable: true, nullMeaning: '没有ID不能删除' }),
  field('list[].office', 'object | null', '公司对象；页面表格展示office.name，编辑时从office.id回填officeId', { nullable: true, nullMeaning: '没有公司对象不能可靠编辑' }),
  field('list[].office.id', 'string | number | null', '公司/销售组织标识；不是页面提交的itemKind值', { nullable: true }),
  field('list[].office.name', 'string | null', '公司名称；只用于展示和编辑表单快照', { nullable: true }),
  field('list[].itemKind', 'string | null', '后端把存储的商品类型JSON值转换后的逗号分隔显示标签；不是编辑提交值数组', { nullable: true }),
  field('list[].branchCode', 'string | null', '分行号', { nullable: true }),
  field('list[].merchantCode', 'string | null', '商户号', { nullable: true }),
  field('list[].ccbpayAccount', 'string | null', '银行收款账号', { nullable: true }),
  field('list[].counterCode', 'string | null', '柜台号', { nullable: true }),
  field('list[].receiptAccountName', 'string | null', '收款银行账户名称', { nullable: true }),
  field('list[].receiptAccountNo', 'string | null', '收款银行卡号', { nullable: true }),
  field('list[].bankName', 'string | null', '收款银行名称', { nullable: true }),
  field('list[].branchName', 'string | null', '支行名称', { nullable: true }),
  field('list[].instCode', 'string | null', '总行联行号', { nullable: true }),
  field('list[].branchInstCode', 'string | null', '开户行联行号', { nullable: true }),
  field('list[].publicKey', 'string | null', '密钥文本', { nullable: true }),
  field('list[].createDate', 'string | number | null', '创建时间原值', { nullable: true }),
  field('list[].updateDate', 'string | number | null', '更新时间原值；页面弹窗不会提交该字段', { nullable: true }),
  field('list[].remarks', 'string | null', '备注原值；页面弹窗没有remarks输入项，编辑不会主动带回', { nullable: true }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', 'SAP收款账号分页结果；CRM响应count已映射为total'),
    field('list', 'object[]', '当前页记录，不是全量数据'),
    field('total', 'number', '符合条件的总记录数；用于分页，不是当前页长度'),
    ...rowFields,
  ],
  empty: 'list=[]且total=0表示当前会话可见范围内没有账号；权限、租户或响应形状错误会抛错。',
}

const treeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('$', 'object[]', '平台销售组织树根节点；页面树选择器以salesId作为value/key'),
    field('[].salesId', 'string', '销售组织节点标识；提交表单officeId时使用', { constraints: ['必须来自当前树，不能用展示名称代替。'] }),
    field('[].name', 'string', '树节点展示名称'),
    field('[].salesParentId', 'string | null', '销售组织父节点标识', { nullable: true }),
    field('[].children', 'object[]', '递归子组织节点；叶节点为空数组'),
  ],
  empty: '[]表示当前会话没有可见的销售组织；不能自行构造officeId。',
}

const formFields: AiField[] = [
  field('form', 'object', 'Portal ModalFormContent 的完整表单状态；SDK按页面processFormData整理，不提交updateDate/createDate/itemKindCode原字段'),
  field('form.id', 'string | number', '编辑时当前列表行ID；新建为空字符串或省略', { optional: true, nullable: true, nullMeaning: '新建没有既有记录ID' }),
  field('form.companyId', 'string | number', '页面内部保留的旧公司ID字段；页面默认空字符串', { optional: true, nullable: true }),
  field('form.office', 'object', '页面根据组织树选择同步维护的公司快照，至少包含id和name；不是用名称替代officeId'),
  field('form.officeId', 'string | number', '从组织树节点.salesId取得的公司标识；必填'),
  field('form.itemKindCode', 'array', '从base-dict-get(dictType="item_kind").entries[].value取得的商品类型值数组；至少一项'),
  field('form.publicKey', 'string', '密钥；页面可空', { optional: true }),
  field('form.branchCode', 'string', '分行号；页面可空', { optional: true }),
  field('form.merchantCode', 'string', '商户号；页面可空', { optional: true }),
  field('form.ccbpayAccount', 'string', '银行收款账号；页面必填'),
  field('form.counterCode', 'string', '柜台号；页面可空', { optional: true }),
  field('form.receiptAccountName', 'string', '收款银行账户名称；页面必填'),
  field('form.receiptAccountNo', 'string', '收款银行卡号；页面必填'),
  field('form.bankName', 'string', '收款银行名称；页面必填'),
  field('form.branchName', 'string', '支行名称；页面必填'),
  field('form.instCode', 'string', '总行联行号；页面可空', { optional: true }),
  field('form.branchInstCode', 'string', '开户行联行号；页面可空', { optional: true }),
]

const draftFields: AiField[] = [
  field('draft', 'object', 'prepareCreate/prepareUpdate整理后的实际save请求体'),
  field('draft.id', 'string | number', '新建为空字符串；编辑为当前列表行ID'),
  field('draft.companyId', 'string | number', '页面保留的旧公司ID字段，默认空字符串'),
  field('draft.office', 'object', '页面维护的公司快照'),
  field('draft.officeId', 'string | number', '从组织树.salesId取得的公司标识'),
  field('draft.itemKind', 'string', '由itemKindCode数组执行JSON.stringify后把双引号全部替换为单引号的字符串；例如["1001","1011"]变为[\'1001\',\'1011\']'),
  field('draft.publicKey', 'string', '密钥；可为空'),
  field('draft.branchCode', 'string', '分行号；可为空'),
  field('draft.merchantCode', 'string', '商户号；可为空'),
  field('draft.ccbpayAccount', 'string', '银行收款账号'),
  field('draft.counterCode', 'string', '柜台号；可为空'),
  field('draft.receiptAccountName', 'string', '收款银行账户名称'),
  field('draft.receiptAccountNo', 'string', '收款银行卡号'),
  field('draft.bankName', 'string', '收款银行名称'),
  field('draft.branchName', 'string', '支行名称'),
  field('draft.instCode', 'string', '总行联行号；可为空'),
  field('draft.branchInstCode', 'string', '开户行联行号；可为空'),
]

const formInput = param('Portal收款账号弹窗的完整表单。', '用户输入、sale-ccb-account-organization-tree返回的节点和当前列表行；itemKindCode需要从base-dict-get取得', {
  type: 'object',
  required: true,
  constraints: [
    'officeId必须来自销售组织树的salesId；itemKindCode必须是item_kind字典value数组且至少一项。',
    'ccbpayAccount、receiptAccountName、receiptAccountNo、bankName、branchName是页面required校验字段；页面没有长度、格式或数值范围规则，SDK不新增这些限制。',
    '新建的id应省略或为空字符串；编辑必须带当前列表行id。页面表单还会保留companyId、office和所有可选文本字段的空字符串默认值。',
  ],
})
const draftInput = param('准备阶段返回的完整save请求草稿。', 'sale-ccb-account-prepare-create/prepare-update.result.draft', {
  type: 'object',
  required: true,
  constraints: ['不能把原始itemKindCode数组或updateDate/createDate放回请求；draft.itemKind必须保留页面生成的单引号JSON字符串。'],
})
const idInput = param('当前列表记录ID。', 'sale-ccb-account-list.list[].id，由用户明确选择', {
  type: 'string | number',
  required: true,
  constraints: ['必须来自当前列表；不能用officeId、商户号或收款账号猜测。'],
})

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', 'Portal保存和删除成功回执是文案；SDK不把文案伪装成新ID或布尔值')],
  empty: 'Promise完成只表示请求成功；必须重新查询核对，不能只凭空回执报告完成。',
}
const preparedOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: draftFields,
  empty: '表单校验失败时准备阶段抛错且不发save；成功只代表本地草稿已整理。',
}
const removePreparedOutput: AiContract['output'] = {
  shape: '{ id: string | number }',
  fields: [field('id', 'string | number', '待删除的当前列表记录ID')],
  empty: 'ID非法时准备阶段抛错且不发DELETE。',
}

const gaps = [
  '尚未在真实测试环境执行本页组织树、列表、新建、编辑、删除及写入后的列表回查；当前证据来自Portal源码、CRM/销售Java源码与离线请求断言。',
]

function base (purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      `只覆盖Portal销售设置下的“SAP-收款账号”页面${pagePath}；不是同一菜单旁的“收款账号”页面，也不是新销售后台的sales/ccb-account接口。`,
      `页面菜单权限是${pagePermission}。新建按钮使用${createPermission}；源码中的编辑和删除行按钮实际检查${rowActionPermission}，SDK不把它们擅自合并成一个权限，也不绕过后端授权。`,
      '列表、保存、删除使用Portal crm.js实例与CRM旧接口；组织树是表单挂载时调用的Portal platform实例，固定携带salesTypeMax="1"。页面module-type=60，不能把这页切到平台默认列表接口。',
      '列表没有筛选字段、排序控件、详情GET或批量删除；编辑直接使用列表行生成ModalFormContent，不暴露页面不可达的额外后端接口。',
      '商品类型候选不是本页单独的HTTP请求，而是Portal全局platform字典item_kind；需要候选时调用base-dict-get并使用entries[].value，不能把列表展示的itemKind标签直接提交。',
    ],
    effect,
    prerequisites: ['使用带会话token、tenantId和crm/platform base URL的SDK；写操作的完整表单或记录ID必须来自用户明确输入/选择。'],
    inputs: {},
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? 'Promise完成只表示Portal接受请求；保存/删除及超时后必须重新list核实，不把空回执当业务结果。' : '返回通过形状校验的页面数据或无副作用的准备草稿。',
    failures: ['非法表单、ID、分页或响应形状在本地失败；权限、租户、网络和后端业务错误原样抛出。', '组织树、列表响应缺字段时抛错，不把空数组伪造成无数据。'],
    idempotency: effect === 'write' ? '页面接口没有requestId幂等契约；保存或删除超时可能已生效，先list核实，不盲目重发。' : null,
    evidence: [
      { source: 'CodeReview_Projects_Js@test/portal/main: app/portal/menus/sale.js:202-203、app/portal/views/dashboard/sale/order/ccb-account/list.vue、ModalFormContent.vue', kind: 'reference', note: '证明页面路径、CRM列表/保存/删除请求、组织树请求、表单字段、转换规则和两个不同按钮权限串。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-crm/.../CcbAccountVueController.java、CcbAccount.java、CcbAccountDao.xml、CrmCcbAccountService.java', kind: 'reference', note: '证明CRM路由、count/list响应、字段映射、租户注入和逻辑删除。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-sales/.../SalesOrganizationController.java、SalesOrganizationPageReqVO.java、SalesOrganizationRespVO.java', kind: 'reference', note: '证明平台组织树路由、salesTypeMax参数、销售组织权限范围和salesId字段。' },
      { source: 'src/capabilities/sale-ccb-account.ts 与 test/sale-ccb-account.test.ts', kind: 'test', note: '锁定实例、请求、字段转换、权限元数据、准备/提交/删除负例；不替代真实环境验证。' },
      { source: 'docs/pages/SAP-收款账号.md', kind: 'reference', note: '记录本页四件套、表单转换、权限边界和真实环境缺口。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'sale-ccb-account-list': {
    ...base('查询当前用户和租户可见的SAP收款账号分页列表。', listOutput, ['展示office.name、itemKind、merchantCode、ccbpayAccount；total只用于分页，不能把当前页当全量。', '编辑时保留目标行完整可见字段，并用office.id回填officeId；商品类型标签要先通过item_kind字典映射回value。']),
    inputs: {
      pageNo: param('页码，从1开始。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认1' }),
      pageSize: param('每页记录数。', '调用方分页状态；Portal styleV2默认20', { type: 'integer', required: false, default: 'SDK默认20', constraints: ['接受10/20/50/100。'] }),
    },
  },
  'sale-ccb-account-organization-tree': {
    ...base('读取SAP收款账号弹窗使用的销售组织公司树。', treeOutput, ['选择节点的salesId填入新建/编辑表单officeId，并同步把节点name、salesId写入form.office；不要把name提交为officeId。']),
  },
  'sale-ccb-account-prepare-create': {
    ...base('按SAP收款账号页面规则整理新建完整表单，不发送save。', preparedOutput, ['用户取消时丢弃result.draft；明确确认后把同一result.draft交给sale-ccb-account-create。'], 'prepare'),
    inputs: { form: formInput },
    steps: [
      { role: 'required', when: '用户明确确认新建', capabilityId: 'sale-ccb-account-create', mapping: { draft: 'result.draft' }, instruction: '提交prepare通过的同一份完整draft；不要把itemKindCode、updateDate或createDate直接交给save。' },
      { role: 'cancel', when: '用户取消新建', instruction: '只丢弃本地草稿，不发送save。' },
    ],
  },
  'sale-ccb-account-create': {
    ...base('新建一条用户确认的SAP收款账号记录。', voidOutput, ['save成功没有新ID回执；成功或超时后按officeId、itemKind、merchantCode、ccbpayAccount、receiptAccountNo等关键字段分页回查，匹配不唯一时不能猜测哪条是本次创建。'], 'write'),
    inputs: { draft: draftInput },
    steps: [{ role: 'recovery', when: '保存成功、超时或响应丢失后核实结果', capabilityId: 'sale-ccb-account-list', mapping: {}, instruction: '重新list并逐字段核对本次draft对应记录；不能只看保存文案或HTTP成功。' }],
  },
  'sale-ccb-account-prepare-update': {
    ...base('按SAP收款账号页面规则整理当前列表行的完整编辑表单，不发送save。', preparedOutput, ['用户取消时丢弃result.draft；明确确认后把同一result.draft交给sale-ccb-account-update。', '表单中的itemKindCode不是列表itemKind标签，需用base-dict-get(dictType="item_kind")按label匹配value后再提交。'], 'prepare'),
    inputs: { form: formInput },
    steps: [
      { role: 'required', when: '用户明确确认编辑', capabilityId: 'sale-ccb-account-update', mapping: { draft: 'result.draft' }, instruction: '提交prepare通过的同一份完整draft，并保留当前列表行id。' },
      { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃本地草稿，不发送save。' },
    ],
  },
  'sale-ccb-account-update': {
    ...base('按用户确认的完整表单编辑一条SAP收款账号记录。', voidOutput, ['页面使用与新建相同的save接口，不是PATCH；draft必须包含页面表单字段。成功或超时后按draft.id回查。'], 'write'),
    inputs: { draft: draftInput },
    steps: [{ role: 'recovery', when: '保存成功、超时或响应丢失后核实结果', capabilityId: 'sale-ccb-account-list', mapping: {}, instruction: '分页查询并找到draft.id，逐字段核对；找不到或字段冲突不能报告已核实。' }],
  },
  'sale-ccb-account-prepare-remove': {
    ...base('准备删除当前列表选定的一条SAP收款账号记录。', removePreparedOutput, ['展示目标公司、商户号和收款账号并等待确认；用户取消时丢弃result.id，不发送DELETE。'], 'prepare'),
    inputs: { id: idInput },
    steps: [
      { role: 'required', when: '用户明确确认删除', capabilityId: 'sale-ccb-account-remove', mapping: { id: 'result.id' }, instruction: '提交同一个当前列表记录ID；完成后重新list核实目标消失。' },
      { role: 'cancel', when: '用户取消删除', instruction: '只丢弃删除草稿，不发送DELETE。' },
    ],
  },
  'sale-ccb-account-remove': {
    ...base('删除当前列表选定的一条SAP收款账号记录。', voidOutput, ['页面只支持单条删除；成功或超时后重新list跨页确认目标ID不再出现，不能只看空回执。'], 'write'),
    inputs: { id: idInput },
    steps: [{ role: 'recovery', when: '删除成功、超时或响应丢失后核实结果', capabilityId: 'sale-ccb-account-list', mapping: {}, instruction: '按原页面可见范围分页查询，确认目标ID消失；超时先核实再决定是否重试。' }],
  },
}

export const SALE_CCB_ACCOUNT_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALE_CCB_ACCOUNT_METHODS).map(id => [id, contracts[id]!]))
export const SALE_CCB_ACCOUNT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALE_CCB_ACCOUNT_METHODS).map(([id, method]) => [`saleCcbAccount.${method}`, SALE_CCB_ACCOUNT_AI_CONTRACTS[id]!]))
