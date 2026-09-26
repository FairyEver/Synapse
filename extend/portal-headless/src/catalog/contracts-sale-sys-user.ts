import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALE_SYS_USER_METHODS } from '../capabilities/sale-sys-user.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const pagePath = '/dashboard/sale/sys/user/list'
const pagePermission = '/dashboard/sale/frame/sys/user'
const editPermission = 'sys:user:edit'
const editOfficePermission = 'sys:user:edit:office'
const editBusinessPermission = 'sys:user:edit:business'
const stopPermission = 'sys:user:stop'
const openPermission = 'sys:user:open'
const stopBatchPermission = 'sys:user:stopBatch'
const openBatchPermission = 'sys:user:openBatch'
const transferPermission = 'sys:user:transfer'

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '销售用户记录ID；详情、编辑、启停和批量操作都使用它。长整型调用方应按字符串保留。'),
  field('list[].salesId', 'string | number | null', '销售用户关联的销售组织ID；编辑时只用于校验不能把用户放到自身组织。', { nullable: true }),
  field('list[].username', 'string | null', '用户工号/登录名。', { nullable: true }),
  field('list[].realName', 'string | null', '用户姓名。', { nullable: true }),
  field('list[].mobile', 'string | null', '手机号。', { nullable: true }),
  field('list[].orgPath', 'string | null', '人系统组织全路径。', { nullable: true }),
  field('list[].salesOrgPath', 'string | null', '销售组织全路径。', { nullable: true }),
  field('list[].roleNames', 'string | null', '角色名称展示文本，不是可提交的角色ID数组。', { nullable: true }),
  field('list[].salesStatus', 'number | null', '销售用户状态；Portal默认查询1，停用提交2，启用提交1。', { nullable: true }),
  field('list[].businessAttributeMap', 'object | null', '店铺ID到外销商品类型值数组的映射；详情和业务属性弹窗使用。', { nullable: true }),
  field('list[].shopIds', '(string | number)[] | null', '用户管辖店铺ID数组。', { nullable: true }),
  field('list[].officeIds', '(string | number)[] | null', '用户销售部范围salesId数组。', { nullable: true }),
  field('list[].organizationId', 'string | number | null', '人系统组织ID；内销物料列表作为organizationId筛选。', { nullable: true }),
  field('list[].salesOrganizationId', 'string | number | null', '销售组织选择值。', { nullable: true }),
  field('list[].roles', 'object[] | null', '详情可能返回的角色对象数组；角色选项另由roleOptions提供。', { nullable: true }),
  field('list[].tenantName', 'string | null', '后端从orgPath派生的租户/组织名称。', { nullable: true }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '用户扩展分页结果；Portal把list和total交给表格。'),
    field('list', 'object[]', '当前筛选页用户记录，不是全量用户。'),
    field('total', 'number', '符合筛选条件的总数，用于翻页。'),
    ...rowFields,
  ],
  empty: 'list=[]且total=0表示当前筛选没有记录；权限、租户、网络或响应形状错误会抛错。',
}

const rowOutput: AiContract['output'] = {
  shape: 'object',
  fields: rowFields.map(item => ({ ...item, path: item.path.replace(/^list\[\]\./, '') })),
  empty: '详情响应缺少有效id时抛错，不伪造空编辑表单。',
}

const optionOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', 'Portal下拉选项。'),
    field('[].value', 'string | number', '提交给Portal的原始选项值；状态字典的数字字符串会转换为数字。'),
    field('[].label', 'string', '页面展示标签，不能替代value。'),
  ],
  empty: '空数组表示后端没有候选；不能自行猜测状态或角色ID。',
}

const treeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '组织树节点。'),
    field('[].id', 'string | number', '节点ID；具体用途取决于树入口。'),
    field('[].name', 'string | null', '节点展示名称。', { nullable: true }),
    field('[].salesId', 'string | number | null', '销售组织ID；销售上级树提交它而不是节点id。', { optional: true, nullable: true }),
    field('[].children', 'object[]', '递归子节点。'),
  ],
  empty: '[]表示当前会话没有可见组织候选；请求失败会抛错。',
}

const shopOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('[]', 'object', '用户可管辖店铺。'), field('[].shopId', 'string | number', '店铺ID；业务属性映射的键和店铺保存都使用它。'), field('[].shopName', 'string | null', '店铺名称。', { optional: true, nullable: true })],
  empty: '[]表示该用户当前没有可选店铺，不等于保存失败。',
}

const itemKindOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('[]', 'object', 'CRM item_kind商品类型选项。'), field('[].value', 'string | number', '外销业务属性提交值。'), field('[].label', 'string', '商品类型显示名称。')],
  empty: '[]表示CRM没有返回商品类型候选；不要把商品名称当提交值。',
}

const domesticCodesOutput: AiContract['output'] = {
  shape: '{ materiels: string | null, codes: string[] }',
  fields: [
    field('materiels', 'string | null', '后端返回的逗号分隔内销物料编码原文；空值规范化为null。', { nullable: true }),
    field('codes', 'string[]', '按逗号拆分后的已分配物料编码；用于初始化内销物料勾选。'),
  ],
  empty: 'materiels=null且codes=[]表示当前用户没有已分配内销物料。',
}

const domesticListOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('list', 'object[]', '当前内销物料分页结果。'),
    field('total', 'number', '符合用户、组织和物料筛选条件的总数。'),
    field('list[].materielId', 'string | number | null', '物料记录ID；', { optional: true, nullable: true }),
    field('list[].materielCode', 'string | null', '保存内销业务时join的唯一物料编码。', { optional: true, nullable: true }),
    field('list[].materielName', 'string | null', '物料名称。', { optional: true, nullable: true }),
    field('list[].materielCategory', 'string | number | null', '物料分类ID。', { optional: true, nullable: true }),
    field('list[].materielCategoryName', 'string | null', '物料分类名称。', { optional: true, nullable: true }),
    field('list[].factoryId', 'string | number | null', '工厂ID。', { optional: true, nullable: true }),
    field('list[].factoryName', 'string | null', '工厂名称。', { optional: true, nullable: true }),
    field('list[].shopId', 'string | number | null', '店铺ID。', { optional: true, nullable: true }),
    field('list[].shopName', 'string | null', '店铺名称。', { optional: true, nullable: true }),
    field('list[].supplierId', 'string | number | null', '供应商ID。', { optional: true, nullable: true }),
    field('list[].supplierName', 'string | null', '供应商名称。', { optional: true, nullable: true }),
    field('list[].isAssigned', 'boolean | null', '该物料是否已分配给当前用户。', { optional: true, nullable: true }),
    field('list[].userId', 'string | number | null', '物料分配目标用户ID。', { optional: true, nullable: true }),
    field('list[].materiels', 'string | null', '后端兼容返回的物料编码字段。', { optional: true, nullable: true }),
    field('list[].selectable', 'boolean | null', 'Portal是否允许选择该行。', { optional: true, nullable: true }),
  ],
  empty: 'list=[]且total=0表示当前内销物料筛选没有结果。',
}

const transferCustomerOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '当前待移交客户组织行。'),
    field('[].organizationId', 'string | number', '客户组织ID；勾选后作为undertakeUpdate的organizationList元素。'),
    field('[].salesOrgName', 'string | null', '客户组织名称。', { optional: true, nullable: true }),
    field('[].salesCode', 'string | null', '客户组织编码。', { optional: true, nullable: true }),
    field('[].realName', 'string | null', '当前负责人姓名。', { optional: true, nullable: true }),
    field('[].mobile', 'string | null', '当前负责人手机号。', { optional: true, nullable: true }),
    field('[].customerNum', 'number | null', '客户数量。', { optional: true, nullable: true }),
    field('[].salesParentId', 'string | number | null', '当前销售上级组织ID。', { optional: true, nullable: true }),
  ],
  empty: '[]表示当前待移交用户没有符合筛选的客户组织；不表示承接提交已完成。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName: string, contentType: string | null, base64: string, byteLength: number }',
  fields: [
    field('fileName', 'string', '导出文件名；响应头没有文件名时默认为用户.xlsx。'),
    field('contentType', 'string | null', '导出响应Content-Type；服务端未返回时为null。', { nullable: true }),
    field('base64', 'string', '导出二进制文件的标准Base64。'),
    field('byteLength', 'number', '文件字节数；必须大于0。'),
  ],
  empty: '空文件或非二进制响应会抛错；不能把浏览器打开下载页当作导出成功。',
}

const trueVoidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', '后端true成功回执被SDK消费后返回undefined；不能从空回执推导业务记录已落库。')],
  empty: '响应不是true或请求抛错时不能报告写入成功；必须按步骤回查。',
}

const queryInputs: Record<string, AiParameter> = {
  orgId: param('公司树筛选节点ID；未选择时发送空字符串。', 'sale-sys-user-company-tree[].id，由用户选择', { type: 'string | number', required: false, nullable: true, default: '空字符串' }),
  username: param('工号/登录名筛选。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  mobile: param('手机号筛选。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  realName: param('姓名筛选。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  roleId: param('角色筛选ID；未选择时发送空字符串。', 'sale-sys-user-role-options[].value，由用户选择', { type: 'string | number', required: false, nullable: true, default: '空字符串' }),
  salesStatus: param('启停状态筛选；省略时复刻Portal默认1。', 'sale-sys-user-status-options[].value，由用户选择', { type: 'string | number', required: false, nullable: true, default: '1' }),
  pageNo: param('从1开始的页码。', '调用方分页状态', { type: 'integer', required: false, default: '1', constraints: ['必须是正整数。'] }),
  pageSize: param('每页条数。', 'Portal分页控件', { type: 'integer', required: false, default: '20', constraints: ['只接受10、20、50、100。'] }),
}

const roleOptionsInputs: Record<string, AiParameter> = {
  keyword: param('角色名称关键字；必须为非空白字符串，SDK会去掉首尾空白后作为服务端name筛选。', '用户明确输入', { type: 'string', required: true, constraints: ['不能为空或全为空格。'] }),
  pageNo: param('从1开始的候选页码。', '调用方分页状态', { type: 'integer', required: false, default: '1', constraints: ['必须是正整数。'] }),
  pageSize: param('候选每页条数。', '调用方分页状态', { type: 'integer', required: false, default: '20', constraints: ['只接受10、20、50、100；不要为了取全量放大。'] }),
}

const idInput = param('当前列表明确选中的用户ID。', 'sale-sys-user-list.list[].id，由用户选择', { type: 'string | number', required: true, constraints: ['不能用工号、姓名或数组下标替代。'] })
const userIdInput = param('目标用户ID。', 'sale-sys-user-list.list[].id或用户明确选择', { type: 'string | number', required: true })
const statusInput = param('当前列表筛选状态。', 'sale-sys-user-list请求所用salesStatus', { type: 'string | number', required: true, constraints: ['编辑/角色/店铺/内销准备要求String(value)==="1"；启用准备要求不是1。'] })
const idsInput = param('当前列表勾选的用户ID数组。', 'sale-sys-user-list.list[].id，由用户明确勾选', { type: '(string | number)[]', required: true, constraints: ['至少一项且不能重复；批量接口body本身就是JSON数组。'] })

const gaps = [
  '尚未在真实测试环境执行本页所有读取、每类写入的prepare→submit→cancel闭环以及写入后的独立回查；当前证据来自Portal源码、固定test/test Java源码、实现和离线请求断言。',
]

function base (purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: `用户意图已经明确为“${purpose}”时使用；如果用户要完成本页的其他读取、准备或提交动作，应改用对应能力，不要把本能力的返回值当成其他动作的输入。`,
    boundaries: [
      `只覆盖保留菜单“系统设置→销售设置→用户扩展”页面${pagePath}及其可达弹窗和内销物料页；不新增独立销售或生产一级菜单能力。`,
      `页面入口受${pagePermission}控制；编辑受${editPermission}控制，销售部范围受${editOfficePermission}控制，外销业务受${editBusinessPermission}控制，单条启停受${stopPermission}/${openPermission}控制，批量启停受${stopBatchPermission}/${openBatchPermission}控制，移交列受${transferPermission}控制。`,
      '平台请求使用platform实例并带销售页面module-type=60；CRM item_kind字典只使用crm实例。列表查询会发送useSystem=6，导出复刻Portal formState，不额外发送useSystem、order或orderField。',
      'Portal是按用户当前列表状态显示动作：编辑及角色/店铺/内销编辑只在筛选启用状态1时可执行，启用只在筛选非1时可执行；prepare阶段拒绝违反该状态边界的调用。',
    ],
    effect,
    prerequisites: ['SDK已绑定当前用户、租户、会话token、platform和crm base URL；用户、角色、组织、店铺和物料候选必须来自当前会话或用户明确选择。'],
    inputs: {},
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? 'Promise完成只表示后端返回true；成功或超时后必须按用户ID、状态或物料编码回查列表/详情。' : effect === 'prepare' ? '得到无副作用的确认草稿；用户取消时只丢弃草稿，不调用写接口。' : '返回通过结构校验的页面数据、候选或文件。',
    failures: ['参数非法、当前页面状态不满足动作条件或响应结构不符时显式失败；权限、租户、网络和后端业务错误原样抛出。', '写请求超时或响应丢失时结果不确定，先回查当前用户状态和字段，不能盲目重发。'],
    idempotency: effect === 'write' ? 'Portal接口没有requestId幂等契约；写入超时先按同一用户/物料编码回查，再决定是否重试。' : null,
    evidence: [
      { source: 'CodeReview_Projects_Js@test/portal/main: app/portal/menus/sale.js:189、app/portal/views/dashboard/sale/sys/user/list.vue及其ModalFormContent.vue、Role/Shop/Office/Business/Domestic组件', kind: 'reference', note: '证明菜单归属、列表参数、候选请求、弹窗表单规则、按钮权限、状态门禁、批量JSON和导出参数。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: SalesUserController.java、SalesUserPageReqVO.java、SalesUserSaveReqVO.java、SalesUserRespVO.java、SalesUserServiceImpl.java、DomesticBusinessSettingController.java及DTO', kind: 'reference', note: '证明用户分页、详情、更新、启停、批量和内销物料接口及服务端字段。' },
      { source: 'src/capabilities/sale-sys-user.ts 与 test/sale-sys-user.test.ts', kind: 'test', note: '锁定请求URL、实例、module-type、表单载荷、权限和状态边界；不替代真实环境验证。' },
      { source: 'docs/pages/用户扩展.md', kind: 'reference', note: '记录本页四件套、逐字段基准、操作步骤和真实环境缺口。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'sale-sys-user-list': { ...base('分页查询用户扩展列表，按公司、工号、手机号、姓名、角色和启停状态筛选。', listOutput, ['展示用户基础信息、组织路径、销售状态和角色文本；保留list[].id进入详情、弹窗和启停。']), inputs: queryInputs },
  'sale-sys-user-status-options': { ...base('读取销售用户启停状态字典选项。', optionOutput, ['把value用于list.salesStatus；label只用于展示。']) },
  'sale-sys-user-role-options': { ...base('按角色名称关键字读取一页销售角色候选。', optionOutput, ['先让用户提供非空关键字，再按pageNo/pageSize读取候选；把value放入list.roleId筛选或角色分配草稿，不能把角色名称当ID；不要执行无关键字全量分页。']), inputs: roleOptionsInputs },
  'sale-sys-user-company-tree': { ...base('读取公司树，供列表公司筛选。', treeOutput, ['提交用户选中的节点id作为list.orgId。']) },
  'sale-sys-user-organization-tree': { ...base('读取用户编辑页的非销售机构树。', treeOutput, ['提交用户选中的节点id作为编辑表单organizationId；节点名称只用于展示。']) },
  'sale-sys-user-get': { ...base('读取一名用户的用户扩展详情。', rowOutput, ['以详情的完整字段初始化编辑、角色、店铺、销售部、外销和内销弹窗；不能用列表文本补造缺失字段。']), inputs: { id: idInput } },
  'sale-sys-user-sales-tree': { ...base('读取用户编辑页的销售上级机构树。', treeOutput, ['用户选择节点的salesId作为表单salesOrganizationId；不能提交节点id或name。']) },
  'sale-sys-user-shop-list': { ...base('读取目标用户可管辖的店铺候选。', shopOutput, ['用shopId初始化和提交店铺勾选；shopName只用于展示。']), inputs: { userId: userIdInput } },
  'sale-sys-user-child-organization-list': { ...base('读取目标用户可管辖的销售部候选。', treeOutput, ['Portal把返回节点name映射为label、salesId映射为value；保存时提交salesId数组。']), inputs: { userId: userIdInput } },
  'sale-sys-user-transfer-target-tree': { ...base('读取用户移交页的承接销售组和销售用户树。', treeOutput, ['只选择salesType为3的销售组节点；提交salesId作为salesOrganizationId，并从该节点users[0].salesId取得承接销售用户salesId。']) },
  'sale-sys-user-transfer-customer-organizations': {
    ...base('按用户和关键字读取移交页待移交客户组织。', transferCustomerOutput, ['用户勾选organizationId；不要把客户名称、salesCode或客户数量当提交ID。']),
    inputs: { userId: userIdInput, filterName: param('手机号、负责人名称或客户名称筛选。', '用户明确输入', { type: 'string', required: false, nullable: true, default: 'null' }) },
  },
  'sale-sys-user-item-kind-options': { ...base('读取CRM item_kind商品类型候选，供外销业务属性弹窗。', itemKindOutput, ['把value按每个店铺保存到businessAttributeMap；label只用于展示。']) },
  'sale-sys-user-domestic-material-codes': { ...base('读取目标用户当前已分配的内销物料编码。', domesticCodesOutput, ['用codes初始化内销物料列表勾选；materiels原文只用于解释服务端数据。']), inputs: { userId: userIdInput } },
  'sale-sys-user-domestic-material-list': {
    ...base('按组织、用户和物料筛选读取内销物料分页。', domesticListOutput, ['按total继续翻页；保存时只取用户确认行的materielCode并用逗号拼接。']),
    inputs: {
      organizationId: param('用户所属人系统组织ID。', 'sale-sys-user-get.organizationId', { type: 'string | number', required: false, nullable: true }),
      userId: userIdInput,
      materielName: param('物料名称筛选。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
      materielCode: param('物料编码筛选。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
      factoryName: param('工厂名称筛选。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
      materielCategory: param('物料分类ID筛选。', '用户选择的分类节点', { type: 'string | number', required: false, nullable: true, default: '空字符串' }),
      supplierName: param('供应商名称筛选。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
      shopName: param('店铺名称筛选。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
      pageNo: queryInputs.pageNo!,
      pageSize: queryInputs.pageSize!,
    },
  },
  'sale-sys-user-prepare-update': {
    ...base('按Portal用户编辑表单规则校验并准备完整用户编辑草稿，不发PUT。', { shape: '{ draft: object }', fields: [field('draft', 'object', '确认前的完整用户编辑草稿。'), field('draft.id', 'string | number', '用户ID。'), field('draft.salesOrganizationId', 'string | number', '销售上级组织选择值；不能等于draft.salesId。')], empty: 'id、salesOrganizationId非法或选择自身作为上级时抛错；不发送请求。' }, ['先get和读取salesTree/organizationTree，确认用户与销售组织，再把草稿展示给用户。', 'salesOrganizationId必须来自salesTree节点salesId，确认后交给update。'], 'prepare'),
    inputs: { form: param('Portal编辑弹窗整份表单。', 'sale-sys-user-get结果、树候选和用户明确修改', { type: 'object', required: true, constraints: ['salesOrganizationId必填；不能等于form.salesId；未知字段按Portal表单整对象原样保留。'] }), 'form.id': param('整份表单中的用户ID。', 'sale-sys-user-get.id', { type: 'string | number', required: true }) },
    steps: [{ role: 'required', when: '开始编辑用户', capabilityId: 'sale-sys-user-get', mapping: { id: 'args.form.id' }, instruction: '读取args.form.id对应用户的最新详情。' }, { role: 'required', when: '用户确认编辑草稿', capabilityId: 'sale-sys-user-update', mapping: { draft: 'result.draft' }, instruction: '把prepare结果原样交给update；不要自己删减Portal表单字段。' }, { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不调用update。' }],
  },
  'sale-sys-user-update': { ...base('提交用户确认的完整用户扩展编辑草稿。', trueVoidOutput, ['请求固定PUT /admin-api/sales/user/update；成功或超时后按同一用户ID回查详情和列表。'], 'write'), inputs: { draft: param('prepareUpdate返回的完整用户编辑草稿。', 'sale-sys-user-prepare-update.result.draft', { type: 'object', required: true }), 'draft.id': param('编辑草稿中的用户ID，用于写后回查。', 'sale-sys-user-prepare-update.result.draft.id', { type: 'string | number', required: true }) }, steps: [{ role: 'recovery', when: 'PUT成功、超时或响应丢失后核实', capabilityId: 'sale-sys-user-get', mapping: { id: 'args.draft.id' }, instruction: '读取同一用户详情逐字段核对；不能把true回执当成独立落库证据。' }] },
  'sale-sys-user-prepare-role-update': { ...base('校验并准备启用用户的角色分配草稿，不发PUT。', { shape: '{ id: string | number, roleIds: (string | number)[] }', fields: [field('id', 'string | number', '目标用户ID。'), field('roleIds', '(string | number)[]', '角色ID数组，可为空表示清空角色。')], empty: '筛选状态不是1、用户ID非法或roleIds不是数组时抛错。', }, ['角色候选必须先由roleOptions读取；用户取消时不写入。'], 'prepare'), inputs: { id: idInput, roleIds: param('角色ID数组。', 'sale-sys-user-role-options[].value及用户确认', { type: '(string | number)[]', required: true }), currentFilterStatus: statusInput }, steps: [{ role: 'required', when: '用户确认角色分配', capabilityId: 'sale-sys-user-update-roles', mapping: { id: 'result.id', roleIds: 'result.roleIds' }, instruction: '提交同一用户ID和角色ID数组。' }, { role: 'cancel', when: '用户取消角色分配', instruction: '丢弃草稿，不调用updateRoles。' }] },
  'sale-sys-user-update-roles': { ...base('保存用户角色ID数组。', trueVoidOutput, ['请求固定PUT /admin-api/sales/user/update，body只含id和roleIds；完成后重新get核对roles或刷新列表。'], 'write'), inputs: { id: idInput, roleIds: param('角色ID数组。', 'sale-sys-user-prepare-role-update.result.roleIds或用户确认', { type: '(string | number)[]', required: true }) }, steps: [{ role: 'recovery', when: 'PUT成功、超时或响应丢失后核实', capabilityId: 'sale-sys-user-get', mapping: { id: 'args.id' }, instruction: '读取详情核对角色终态。' }] },
  'sale-sys-user-prepare-shop-update': { ...base('校验并准备启用用户的店铺管辖范围草稿，不发PUT。', { shape: '{ id: string | number, shopIds: (string | number)[] }', fields: [field('id', 'string | number', '目标用户ID。'), field('shopIds', '(string | number)[]', '店铺ID数组，可为空。')], empty: '筛选状态不是1、用户ID非法或shopIds不是数组时抛错。' }, ['先读取shops候选，用户确认后交给updateShops；取消不写入。'], 'prepare'), inputs: { id: idInput, shopIds: param('店铺ID数组。', 'sale-sys-user-shop-list[].shopId及用户确认', { type: '(string | number)[]', required: true }), currentFilterStatus: statusInput }, steps: [{ role: 'required', when: '用户确认店铺范围', capabilityId: 'sale-sys-user-update-shops', mapping: { id: 'result.id', shopIds: 'result.shopIds' }, instruction: '提交同一用户ID和店铺ID数组。' }, { role: 'cancel', when: '用户取消店铺设置', instruction: '丢弃草稿，不调用updateShops。' }] },
  'sale-sys-user-update-shops': { ...base('保存用户管辖店铺ID数组。', trueVoidOutput, ['请求固定PUT /admin-api/sales/user/update，body只含id和shopIds；完成后刷新店铺弹窗或详情核对。'], 'write'), inputs: { id: idInput, shopIds: param('店铺ID数组。', 'sale-sys-user-prepare-shop-update.result.shopIds或用户确认', { type: '(string | number)[]', required: true }) }, steps: [{ role: 'recovery', when: 'PUT成功、超时或响应丢失后核实', capabilityId: 'sale-sys-user-shop-list', mapping: { userId: 'args.id' }, instruction: '重新读取同一用户店铺候选并核对选中关系。' }] },
  'sale-sys-user-prepare-office-update': { ...base('按权限和启用状态准备用户销售部范围草稿，不发PUT。', { shape: '{ id: string | number, officeIds: (string | number)[] }', fields: [field('id', 'string | number', '目标用户ID。'), field('officeIds', '(string | number)[]', '销售组织salesId数组，可为空。')], empty: '筛选状态不是1、用户ID非法或officeIds不是数组时抛错。' }, ['只有sys:user:edit:office权限才可编辑；候选由child-organization-list提供，提交值是salesId而不是人系统id。'], 'prepare'), inputs: { id: idInput, officeIds: param('销售组织salesId数组。', 'sale-sys-user-child-organization-list[].salesId及用户确认', { type: '(string | number)[]', required: true }), currentFilterStatus: statusInput }, steps: [{ role: 'required', when: '用户确认销售部范围', capabilityId: 'sale-sys-user-update-offices', mapping: { id: 'result.id', officeIds: 'result.officeIds' }, instruction: '提交同一用户ID和salesId数组。' }, { role: 'cancel', when: '用户取消销售部范围设置', instruction: '丢弃草稿，不调用updateOffices。' }] },
  'sale-sys-user-update-offices': { ...base('保存用户销售部范围salesId数组。', trueVoidOutput, ['请求固定PUT /admin-api/sales/user/update，body只含id和officeIds；完成后重新读取childOrganizations核对。'], 'write'), inputs: { id: idInput, officeIds: param('销售组织salesId数组。', 'sale-sys-user-prepare-office-update.result.officeIds或用户确认', { type: '(string | number)[]', required: true }) }, steps: [{ role: 'recovery', when: 'PUT成功、超时或响应丢失后核实', capabilityId: 'sale-sys-user-child-organization-list', mapping: { userId: 'args.id' }, instruction: '读取同一用户销售部候选，核对详情officeIds与用户选择。' }] },
  'sale-sys-user-prepare-business-update': { ...base('按权限和启用状态准备用户外销业务属性草稿，不发PUT。', { shape: '{ id: string | number, businessAttributeMap: object }', fields: [field('id', 'string | number', '目标用户ID。'), field('businessAttributeMap', 'object', '店铺ID到商品类型value数组的映射，可为空数组。')], empty: '筛选状态不是1、用户ID非法或映射值不是数组时抛错。' }, ['先读取shops和itemKindOptions；每个店铺的类型value来自CRM item_kind，用户确认后交给updateBusiness。'], 'prepare'), inputs: { id: idInput, businessAttributeMap: param('店铺ID到商品类型值数组的映射。', 'sale-sys-user-shop-list[].shopId、sale-sys-user-item-kind-options[].value及用户确认', { type: 'object', required: true }), currentFilterStatus: statusInput }, steps: [{ role: 'required', when: '用户确认外销业务属性', capabilityId: 'sale-sys-user-update-business', mapping: { id: 'result.id', businessAttributeMap: 'result.businessAttributeMap' }, instruction: '提交同一用户ID和映射；不要把label写入后端。' }, { role: 'cancel', when: '用户取消外销业务属性设置', instruction: '丢弃草稿，不调用updateBusiness。' }] },
  'sale-sys-user-update-business': { ...base('保存用户外销业务属性映射。', trueVoidOutput, ['请求固定PUT /admin-api/sales/user/update，body只含id和businessAttributeMap；完成后重新get核对。'], 'write'), inputs: { id: idInput, businessAttributeMap: param('店铺ID到商品类型值数组的映射。', 'sale-sys-user-prepare-business-update.result.businessAttributeMap或用户确认', { type: 'object', required: true }) }, steps: [{ role: 'recovery', when: 'PUT成功、超时或响应丢失后核实', capabilityId: 'sale-sys-user-get', mapping: { id: 'args.id' }, instruction: '读取详情核对businessAttributeMap。' }] },
  'sale-sys-user-prepare-domestic-save': { ...base('按权限和启用状态准备用户内销物料保存草稿，不发POST。', { shape: '{ userId: string | number, materials: string }', fields: [field('userId', 'string | number', '目标用户ID。'), field('materials', 'string', '用户确认的物料编码逗号字符串；由物料行materielCode按顺序join。')], empty: '筛选状态不是1、用户ID非法、物料行缺少materielCode或行的selectable=false时抛错。' }, ['先读取domesticMaterialCodes和domesticMaterialList；用户确认行后只取materielCode并join，不发送materielId；不能选择selectable=false的行。'], 'prepare'), inputs: { userId: userIdInput, materials: param('用户确认的内销物料行数组。', 'sale-sys-user-domestic-material-list.list[]及用户选择', { type: 'object[]', required: true }), currentFilterStatus: statusInput }, steps: [{ role: 'required', when: '用户确认内销物料分配', capabilityId: 'sale-sys-user-save-domestic', mapping: { userId: 'result.userId', materials: 'result.materials' }, instruction: '把prepare返回的逗号字符串原样提交。' }, { role: 'cancel', when: '用户取消内销物料设置', instruction: '丢弃草稿，不调用saveDomestic。' }] },
  'sale-sys-user-save-domestic': { ...base('保存用户内销物料编码逗号字符串。', trueVoidOutput, ['请求固定POST /admin-api/sales/domestic-business-setting/save，body是userId和materials；完成后重新读取domesticMaterialCodes和列表核对。'], 'write'), inputs: { userId: userIdInput, materials: param('prepareDomesticSave返回的逗号字符串。', 'sale-sys-user-prepare-domestic-save.result.materials', { type: 'string', required: true }) }, steps: [{ role: 'recovery', when: 'POST成功、超时或响应丢失后核实', capabilityId: 'sale-sys-user-domestic-material-codes', mapping: { userId: 'args.userId' }, instruction: '重新读取同一用户已分配物料编码，逐项核对；不确定时不要盲目重发。' }] },
  'sale-sys-user-prepare-stop': { ...base('准备停用当前启用筛选下的一名用户，不发PUT。', { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待确认停用的用户ID。')], empty: '筛选状态不是1或ID非法时抛错。' }, ['只有用户明确确认且拥有sys:user:stop时交给stop；取消不发请求。'], 'prepare'), inputs: { id: idInput, currentFilterStatus: statusInput }, steps: [{ role: 'required', when: '用户确认停用', capabilityId: 'sale-sys-user-stop', mapping: { id: 'result.id' }, instruction: '提交同一用户ID。' }, { role: 'cancel', when: '用户取消停用', instruction: '丢弃id，不调用stop。' }] },
  'sale-sys-user-stop': { ...base('停用一名销售用户。', trueVoidOutput, ['请求固定PUT /admin-api/sales/user/update，body为{id,salesStatus:2}；完成后按同一ID读取详情确认状态。'], 'write'), inputs: { id: idInput }, steps: [{ role: 'recovery', when: 'PUT成功、超时或响应丢失后核实', capabilityId: 'sale-sys-user-get', mapping: { id: 'args.id' }, instruction: '读取同一用户详情核对salesStatus；不能只凭true报告停用已完成。' }] },
  'sale-sys-user-prepare-open': { ...base('准备启用当前非启用筛选下的一名用户，不发PUT。', { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待确认启用的用户ID。')], empty: '筛选状态为1或ID非法时抛错。' }, ['只有用户明确确认且拥有sys:user:open时交给open；后端还会执行组织和销售组业务校验。'], 'prepare'), inputs: { id: idInput, currentFilterStatus: statusInput }, steps: [{ role: 'required', when: '用户确认启用', capabilityId: 'sale-sys-user-open', mapping: { id: 'result.id' }, instruction: '提交同一用户ID。' }, { role: 'cancel', when: '用户取消启用', instruction: '丢弃id，不调用open。' }] },
  'sale-sys-user-open': { ...base('启用一名销售用户。', trueVoidOutput, ['请求固定PUT /admin-api/sales/user/update，body为{id,salesStatus:1}；后端可能因组织未启用或销售组已有用户而拒绝。'], 'write'), inputs: { id: idInput }, steps: [{ role: 'recovery', when: 'PUT成功、超时或响应丢失后核实', capabilityId: 'sale-sys-user-get', mapping: { id: 'args.id' }, instruction: '读取同一用户详情核对salesStatus；后端拒绝时保留原错误。' }] },
  'sale-sys-user-prepare-batch-stop': { ...base('准备批量停用当前启用筛选下勾选的用户，不发POST。', { shape: '{ ids: (string | number)[] }', fields: [field('ids', '(string | number)[]', '去重后的用户ID数组。')], empty: '筛选状态不是1、数组为空、ID非法或重复时抛错。' }, ['用户确认后交给batchStop；Portal请求body是数组本身。'], 'prepare'), inputs: { ids: idsInput, currentFilterStatus: statusInput }, steps: [{ role: 'required', when: '用户确认批量停用', capabilityId: 'sale-sys-user-batch-stop', mapping: { ids: 'result.ids' }, instruction: '提交同一数组，不包装为对象。' }, { role: 'cancel', when: '用户取消批量停用', instruction: '丢弃ids，不调用batchStop。' }] },
  'sale-sys-user-batch-stop': { ...base('批量停用销售用户。', trueVoidOutput, ['请求固定POST /admin-api/sales/user/batch-disable，JSON body是用户ID数组；成功或超时后逐项刷新确认。'], 'write'), inputs: { ids: idsInput }, steps: [{ role: 'recovery', when: 'POST成功、超时或响应丢失后核实', capabilityId: 'sale-sys-user-get', mapping: {}, instruction: '对args.ids逐项调用get读取详情核对salesStatus；部分成功时报告逐项结果，不整批盲重发。' }] },
  'sale-sys-user-prepare-batch-open': { ...base('准备批量启用当前非启用筛选下勾选的用户，不发POST。', { shape: '{ ids: (string | number)[] }', fields: [field('ids', '(string | number)[]', '去重后的用户ID数组。')], empty: '筛选状态为1、数组为空、ID非法或重复时抛错。' }, ['用户确认后交给batchOpen；后端逐项执行启用业务校验。'], 'prepare'), inputs: { ids: idsInput, currentFilterStatus: statusInput }, steps: [{ role: 'required', when: '用户确认批量启用', capabilityId: 'sale-sys-user-batch-open', mapping: { ids: 'result.ids' }, instruction: '提交同一数组，不包装为对象。' }, { role: 'cancel', when: '用户取消批量启用', instruction: '丢弃ids，不调用batchOpen。' }] },
  'sale-sys-user-batch-open': { ...base('批量启用销售用户。', trueVoidOutput, ['请求固定POST /admin-api/sales/user/batch-enable，JSON body是用户ID数组；成功或超时后逐项刷新确认。'], 'write'), inputs: { ids: idsInput }, steps: [{ role: 'recovery', when: 'POST成功、超时或响应丢失后核实', capabilityId: 'sale-sys-user-get', mapping: {}, instruction: '对args.ids逐项调用get读取详情核对salesStatus；后端拒绝项保留错误并单独报告。' }] },
  'sale-sys-user-prepare-transfer': {
    ...base('校验并准备用户客户移交草稿，不发PUT。', { shape: '{ sourceUserId: string | number, salesOrganizationId: string | number, salesId: string | number, organizationList: (string | number)[] }', fields: [field('sourceUserId', 'string | number', '待移交用户ID，仅用于写后回查。'), field('salesOrganizationId', 'string | number', '承接销售组ID，来自移交承接树节点salesId。'), field('salesId', 'string | number', '承接销售用户ID，来自承接树节点users[0].salesId。'), field('organizationList', '(string | number)[]', '用户确认的客户组织ID数组，至少一项且不重复。')], empty: '来源用户、承接销售组、承接销售用户或客户组织数组非法时抛错；不发送请求。' }, ['必须先读取承接树和待移交客户组织；用户取消时只丢弃草稿。'], 'prepare'),
    inputs: {
      sourceUserId: userIdInput,
      salesOrganizationId: param('承接销售组ID。', 'sale-sys-user-transfer-target-tree[].salesId，由用户选择', { type: 'string | number', required: true }),
      salesId: param('承接销售用户ID。', '所选承接树节点users[0].salesId，由Portal组件选择', { type: 'string | number', required: true }),
      organizationList: param('待移交客户组织ID数组。', 'sale-sys-user-transfer-customer-organizations[].organizationId，由用户明确勾选', { type: '(string | number)[]', required: true }),
    },
    steps: [{ role: 'required', when: '用户确认承接销售组、承接销售用户和至少一个客户组织后', capabilityId: 'sale-sys-user-transfer', mapping: { sourceUserId: 'result.sourceUserId', salesOrganizationId: 'result.salesOrganizationId', salesId: 'result.salesId', organizationList: 'result.organizationList' }, instruction: '提交准备结果；取消只丢弃草稿，不调用transfer。' }, { role: 'cancel', when: '用户取消移交', instruction: '丢弃草稿，不发送undertakeUpdate。' }],
  },
  'sale-sys-user-transfer': {
    ...base('提交用户已确认的客户组织移交。', trueVoidOutput, ['固定PUT /admin-api/sales/organization/undertakeUpdate；请求体只发送salesOrganizationId、salesId和organizationList，不发送sourceUserId。完成后用sourceUserId重新读取待移交客户组织，核对选中客户已不再属于原用户。'], 'write'),
    inputs: { sourceUserId: userIdInput, salesOrganizationId: param('承接销售组ID。', 'sale-sys-user-prepare-transfer.result.salesOrganizationId', { type: 'string | number', required: true }), salesId: param('承接销售用户ID。', 'sale-sys-user-prepare-transfer.result.salesId', { type: 'string | number', required: true }), organizationList: param('客户组织ID数组。', 'sale-sys-user-prepare-transfer.result.organizationList', { type: '(string | number)[]', required: true }) },
    steps: [{ role: 'recovery', when: 'PUT成功、超时或响应丢失后核实', capabilityId: 'sale-sys-user-transfer-customer-organizations', mapping: { userId: 'args.sourceUserId', filterName: 'literal:null' }, instruction: '重新读取原用户的待移交客户组织，逐项核对organizationId；未找到不等于写入成功，需结合后端错误和承接方数据继续核实。' }],
  },
  'sale-sys-user-export': { ...base('按用户扩展当前筛选和分页导出用户Excel。', fileOutput, ['把Base64按fileName保存或传输；导出不把会话token拼入URL，也不发送列表customLoad额外的useSystem。']), inputs: queryInputs },
}

export const SALE_SYS_USER_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALE_SYS_USER_METHODS).map(id => [id, contracts[id]!]))
export const SALE_SYS_USER_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALE_SYS_USER_METHODS).map(([id, method]) => [`saleSysUser.${method}`, SALE_SYS_USER_AI_CONTRACTS[id]!]))
