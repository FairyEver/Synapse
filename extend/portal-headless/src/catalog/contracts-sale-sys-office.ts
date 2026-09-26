import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALE_SYS_OFFICE_METHODS } from '../capabilities/sale-sys-office.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const pagePath = '/dashboard/sale/sys/office/list'
const pagePermission = '/dashboard/sale/frame/sys/office'
const editPermission = 'sys:office:edit'
const stopPermission = 'sys:office:stop'
const stopBatchPermission = 'sys:office:stopBatch'

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '人系统组织主键；编辑详情和停用都使用它，长整数优先保留为字符串。'),
  field('list[].pid', 'string | number | null', '后端树结构的上级组织ID；与parentId均为只读回显字段。', { nullable: true }),
  field('list[].parentId', 'string | number | null', '人系统上级机构ID；列表筛选parentId使用这个值。', { nullable: true }),
  field('list[].orgPath', 'string | null', '人系统机构全路径名称；列表展示字段。', { nullable: true }),
  field('list[].salesOrgPath', 'string | null', '销售机构全路径名称；详情/后端扩展字段。', { nullable: true }),
  field('list[].name', 'string | null', '机构名称；当前页面只读，不能在编辑提交中改名。', { nullable: true }),
  field('list[].code', 'string | null', '人系统机构编码；当前页面只读，不能与salesCode混用。', { nullable: true }),
  field('list[].salesCode', 'string | null', '销售机构编码；编辑表单必填，改变时先调用checkCode。', { nullable: true }),
  field('list[].salesType', 'number | null', '机构类型字典值；3时编辑表单才提交销售范围和销售业务。', { nullable: true }),
  field('list[].salesGrade', 'number | null', '机构级别字典值；编辑表单可选。', { nullable: true }),
  field('list[].salesMaster', 'string | number | null', '负责人用户ID；不是负责人姓名。', { nullable: true }),
  field('list[].salesStatus', 'number | null', '销售机构状态字典值；列表默认筛选1，停用提交固定为2。', { nullable: true }),
  field('list[].groupSalesAreaCodes', 'string | null', '销售范围逗号字符串；详情回显时Portal拆成数字数组。', { nullable: true }),
  field('list[].salesBusiness', 'string | null', '销售业务逗号字符串；详情回显时Portal拆成数组，提交字段名仍是salesBusiness。', { nullable: true }),
  field('list[].salesId', 'string | number | null', '销售组织自身ID；salesParentId不能选择同一值。', { nullable: true }),
  field('list[].salesParentId', 'string | number | null', '销售上级组织ID；编辑表单必填，值来自salesTree节点的salesId。', { nullable: true }),
  field('list[].defaultSalesParentId', 'string | number | null', '后端提供的默认销售上级ID；Portal详情回显时仅在salesParentId为空时采用。', { nullable: true }),
  field('list[].salesParentIds', 'string | null', '销售上级链；编辑提交时随详情原样带回（如果详情含有该字段）。', { nullable: true }),
  field('list[].updateTime', 'string | number | null', '最后更新时间原值。', { nullable: true }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '机构扩展分页结果；Portal把list和total直接交给表格。'),
    field('list', 'object[]', '当前页机构记录，不是全量组织树。'),
    field('total', 'number', '符合筛选条件的总数，用于翻页。'),
    ...rowFields,
  ],
  empty: 'list=[]且total=0表示当前筛选没有记录；权限、租户或响应形状错误会抛错。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: rowFields.map(item => ({ ...item, path: item.path.replace(/^list\[\]\./, '') })),
  empty: '详情响应缺少有效id时抛错，不伪造空编辑表单。',
}

const treeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '机构树节点；根据调用入口可能用于人系统隶属机构、销售上级机构或负责人选择。'),
    field('[].id', 'string | number', '节点人系统组织/用户ID；隶属机构树用它筛选parentId。'),
    field('[].salesId', 'string | number | null', '销售组织节点ID；salesTree中选择上级时提交该字段。', { nullable: true }),
    field('[].name', 'string', '节点展示名称；负责人树中用户节点会把realName映射到name。'),
    field('[].disabled', 'boolean | undefined', '负责人树中没有realName的组织节点被Portal标为不可选；没有该字段不代表可绕过页面权限。', { optional: true }),
    field('[].users', 'object[] | undefined', 'primaryPersonTree原始节点携带的用户数组；SDK同时把用户追加到children供树选择。', { optional: true }),
    field('[].children', 'object[]', '子节点；递归结构与当前节点相同。'),
  ],
  empty: '[]表示当前会话没有可见组织/负责人候选；请求失败会抛错，不返回假空树。',
}

const optionOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', 'Portal字典分页list映射出的下拉选项。'),
    field('[].value', 'number', '字典value转成数字后的值；列表状态、机构类型和级别均依赖它。'),
    field('[].label', 'string', 'Portal字典显示标签；调用方只展示，不把标签当提交值。'),
  ],
  empty: '空数组表示该字典没有候选；不能自行猜测机构类型或状态。',
}

const businessOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '销售业务树根节点；Portal把它的children作为TreeSelect数据源。'),
    field('[].value', 'string | number | null', '业务节点提交值；多选后join成salesBusiness。', { optional: true, nullable: true }),
    field('[].label', 'string | null', '业务节点展示标签。', { optional: true, nullable: true }),
    field('[].children', 'object[]', '下级业务节点，递归结构同当前节点。'),
  ],
  empty: '[]表示业务接口没有返回可选根节点；不要用业务名称猜测提交值。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName: string, contentType: string | null, base64: string, byteLength: number }',
  fields: [
    field('fileName', 'string', '下载文件名；Java默认是机构.xls，若响应头带文件名则优先使用响应头。'),
    field('contentType', 'string | null', '导出响应Content-Type；服务端未返回时为null。', { nullable: true }),
    field('base64', 'string', '导出二进制文件的标准Base64；调用方负责保存或传输。'),
    field('byteLength', 'number', '导出文件字节数；必须大于0。'),
  ],
  empty: '空文件或非二进制响应会抛错；不能把打开浏览器页面当作导出成功。',
}

const updateFields: AiField[] = [
  field('draft.id', 'string | number', '当前详情/列表的机构ID。'),
  field('draft.salesId', 'string | number', '销售组织自身ID；必须来自详情，不能用人系统id替代。'),
  field('draft.salesCode', 'string', '销售机构编码；页面必填。'),
  field('draft.salesType', 'number', '机构类型；页面必填，值为3时才出现并提交两个扩展字段。'),
  field('draft.salesParentId', 'string | number', '销售上级组织salesId；页面必填且不能等于draft.salesId。'),
  field('draft.salesParentIds', 'string | null | undefined', '销售上级链；详情含有时原样提交。', { optional: true, nullable: true }),
  field('draft.salesGrade', 'number | null | undefined', '机构级别；Portal没有required校验，详情有值时原样带回。', { optional: true, nullable: true }),
  field('draft.salesMaster', 'string | number', '负责人用户ID；缺省时Portal表单默认空字符串。'),
  field('draft.salesStatus', 'number', '机构状态；页面必填。'),
  field('draft.groupSalesAreaCodes', 'string | undefined', 'salesType=3时，范围数组用逗号join；非3时省略。', { optional: true }),
  field('draft.salesBusiness', 'string | undefined', 'salesType=3时，groupSalesBusinessCodes数组用逗号join；非3时省略。', { optional: true }),
]

const formFields: AiField[] = [
  field('form.id', 'string | number', '详情中的机构ID。'),
  field('form.salesId', 'string | number', '详情中的销售组织ID。'),
  field('form.salesCode', 'string', '销售机构编码；非空校验，编码变更时还要先checkCode。'),
  field('form.salesType', 'number', '机构类型；非空校验。'),
  field('form.salesParentId', 'string | number', '销售上级组织salesId；非空且不能等于form.salesId。'),
  field('form.salesParentIds', 'string | null | undefined', '详情中的销售上级链。', { optional: true, nullable: true }),
  field('form.salesGrade', 'number | null | undefined', '机构级别；Portal不做required校验。', { optional: true, nullable: true }),
  field('form.salesMaster', 'string | number | null | undefined', '负责人用户ID；缺省按Portal表单默认空字符串。', { optional: true, nullable: true }),
  field('form.salesStatus', 'number', '启用状态；非空校验。'),
  field('form.groupSalesAreaCodes', 'array | null | undefined', 'salesType=3时的销售范围value数组；提交前join为字符串。', { optional: true, nullable: true }),
  field('form.groupSalesBusinessCodes', 'array | null | undefined', 'salesType=3时的销售业务value数组；提交前改名并join为salesBusiness。', { optional: true, nullable: true }),
]

const listInputs: Record<string, AiParameter> = {
  parentId: param('隶属机构筛选值。', 'sale-sys-office-organization-tree.[].id，由用户选择', { type: 'string | number', required: false, nullable: true, default: '空字符串' }),
  name: param('机构名称模糊筛选。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  code: param('人系统机构编码筛选。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  salesCode: param('销售机构编码筛选。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  salesType: param('机构类型字典值。', 'sale-sys-office-type-options.[].value，由用户选择', { type: 'string | number', required: false, nullable: true, default: '空字符串' }),
  salesStatus: param('启用状态筛选；Portal默认查询启用机构。', 'sale-sys-office-status-options.[].value，由用户选择', { type: 'string | number', required: false, nullable: true, default: '1' }),
  pageNo: param('从1开始的页码。', '调用方分页状态', { type: 'integer', required: false, default: '1', constraints: ['必须是正整数。'] }),
  pageSize: param('每页条数。', 'Portal分页控件', { type: 'integer', required: false, default: '20', constraints: ['只接受10、20、50、100。'] }),
}

const idInput = param('当前列表选中的机构ID。', 'sale-sys-office-list.list[].id，由用户明确选择', { type: 'string | number', required: true, constraints: ['不能用salesId、机构名称或编码猜测。'] })
const activeFilterInput = param('当前列表筛选状态。', 'sale-sys-office-list请求所用salesStatus', { type: 'number | string', required: true, constraints: ['Portal按钮仅在String(value)==="1"时显示；停用准备阶段拒绝其它状态。'] })
const idsParam = param('当前列表勾选的机构ID数组。', 'sale-sys-office-list.list[].id，由用户明确勾选', { type: '(string | number)[]', required: true, constraints: ['至少一项，不能重复；批量提交时作为JSON数组本身发送。'] })
const gaps = [
  '尚未在真实测试环境执行本页列表、三组字典、三类树、详情、编码校验、编辑、单条停用、批量停用、导出及每条写入后的回查；当前证据来自Portal源码、固定test/test Java源码与离线请求断言。',
]

function base (purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      `只覆盖保留范围“系统设置→销售设置→机构扩展”页面${pagePath}；不覆盖独立的生产、采购、财务、资产或科技根菜单。`,
      `页面入口受${pagePermission}控制；编辑受${editPermission}控制，单条停用受${stopPermission}控制，批量停用受${stopBatchPermission}控制。页面没有新增组织能力，顶部提示用户到人系统创建；SDK不发布隐藏的创建接口。`,
      '列表、组织树、字典、销售上级树、负责人树、业务树、详情、更新、停用和导出使用Portal platform实例并带销售页面module-type=60；销售编码唯一性校验明确使用CRM实例的/vue/sys/office/checkOfficeCode。',
      '列表筛选发送order/orderField空字符串，导出不发送这两个排序字段；导出使用SDK会话请求头，不把浏览器token拼到URL。',
      '编辑提交严格复刻ModalFormContent的pick字段；name、code、parentId、remarks等只读或未pick字段不会发给update。',
    ],
    effect,
    prerequisites: ['SDK已绑定当前用户、租户、会话token、platform和crm base URL；写操作的机构ID、详情和候选值必须来自当前用户可见页面或用户明确输入。'],
    inputs: {},
    output,
    consume,
    steps: [],
    completion: effect === 'write'
      ? 'Promise完成只表示后端返回true；编辑、单条停用和批量停用完成或超时后都必须重新查询列表和机构树核对终态。'
      : effect === 'prepare'
        ? '得到无副作用的确认草稿；用户取消时只丢弃草稿，不调用写接口。'
        : '返回通过结构校验的页面数据、选项或文件。',
    failures: ['参数非法、分页错误或响应结构不符时显式失败；权限、租户、网络和后端业务错误原样抛出。', '写请求超时或响应丢失时结果不确定，先按ID/编码刷新列表核实，不能盲目重发。'],
    idempotency: effect === 'write' ? 'Portal接口没有requestId幂等契约；更新/停用可能已经生效，必须回查后再决定是否重试。' : null,
    evidence: [
      { source: 'CodeReview_Projects_Js@test/portal/main: app/portal/menus/sale.js:199、app/portal/views/dashboard/sale/sys/office/list.vue、ModalFormContent.vue、common/libs/renren/list.js', kind: 'reference', note: '证明菜单路径/权限、查询字段、默认状态、树加载、详情回显、表单校验、pick提交、停用、批量JSON和导出参数。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-sales/.../SalesOrganizationController.java、SalesOrganizationPageReqVO.java、SalesOrganizationSaveReqVO.java、SalesOrganizationRespVO.java、SalesOrganizationMapper.xml、SalesOrganizationServiceImpl.java', kind: 'reference', note: '证明销售组织分页、树、详情、导出、更新、批量停用路由及DTO字段、状态和业务校验。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-crm/.../OfficeVueController.java', kind: 'reference', note: '证明旧CRM机构编码校验路由和oldCode/code参数。' },
      { source: 'src/capabilities/sale-sys-office.ts 与 test/sale-sys-office.test.ts', kind: 'test', note: '锁定页面请求形状、平台/CRM实例、表单字段裁剪、条件join、权限元数据、导出文件和写操作prepare链；不替代真实环境验证。' },
      { source: 'docs/pages/机构扩展.md', kind: 'reference', note: '记录本页四件套、逐字段基准、权限边界和真实环境缺口。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'sale-sys-office-list': {
    ...base('分页查询机构扩展列表，按人系统机构、名称、编码、销售类型和状态筛选。', listOutput, ['展示orgPath、name、code、salesCode、salesType、salesStatus和updateTime；total用于翻页。', '编辑或停用时保留当前行id，并先确认当前筛选salesStatus是否为1。']),
    inputs: listInputs,
  },
  'sale-sys-office-organization-tree': {
    ...base('读取列表左侧的非销售机构树，供parentId筛选。', treeOutput, ['用户选择节点后把节点id放入list.parentId；name只用于展示，不能替代id。']),
  },
  'sale-sys-office-status-options': {
    ...base('读取sales_organization_status字典下拉选项。', optionOutput, ['把value用于list.salesStatus或编辑表单salesStatus；不要把label当状态值。']),
  },
  'sale-sys-office-grade-options': {
    ...base('读取sys_office_grade字典下拉选项。', optionOutput, ['把value用于编辑表单salesGrade；Portal对该字段没有required校验。']),
  },
  'sale-sys-office-type-options': {
    ...base('读取sys_office_type字典下拉选项。', optionOutput, ['把value用于list.salesType和编辑表单salesType；salesType=3时才需要额外销售范围/业务。']),
  },
  'sale-sys-office-get': {
    ...base('读取当前列表行的机构扩展编辑详情。', detailOutput, ['用返回的salesId、salesParentId、salesParentIds、salesCode、salesType、salesGrade、salesMaster和salesStatus构造编辑表单。', 'Portal详情回显会把groupSalesAreaCodes按逗号拆成数字数组、salesBusiness按逗号拆成数组；调用prepareUpdate时再按页面规则join。']),
    inputs: { id: idInput },
  },
  'sale-sys-office-sales-tree': {
    ...base('读取编辑弹窗的销售上级机构树。', treeOutput, ['用户选择节点的salesId作为form.salesParentId；不能提交节点id或name。']),
  },
  'sale-sys-office-primary-person-tree': {
    ...base('读取编辑弹窗的负责人候选树。', treeOutput, ['选择负责人用户节点的id作为form.salesMaster；组织节点没有realName并被Portal标为disabled，不能把组织节点当负责人。']),
  },
  'sale-sys-office-business-tree': {
    ...base('读取salesType=3编辑弹窗的销售业务树。', businessOutput, ['选择节点value填入form.groupSalesBusinessCodes；prepareUpdate会把数组join到salesBusiness。']),
  },
  'sale-sys-office-check-code': {
    ...base('校验销售机构编码是否可用；编码未修改时复刻Portal直接返回true且不发请求。', { shape: 'boolean', fields: [field('$', 'boolean', 'true表示CRM校验通过，false表示编码已存在或不可用。')], empty: '响应不是boolean时抛错；网络/权限错误不会伪装成可用。' }, ['编码校验返回false时不要调用sale-sys-office-update；修改编码后必须重新校验。']),
    inputs: {
      code: param('当前编辑表单的销售机构编码。', '用户输入form.salesCode', { type: 'string', required: true, constraints: ['Portal拒绝空字符串；保留非空字符串原值。'] }),
      oldCode: param('详情中的原销售机构编码。', 'sale-sys-office-get.salesCode', { type: 'string', required: false, nullable: true, constraints: ['当code与oldCode相同且oldCode非空时Portal不发CRM请求。'] }),
    },
  },
  'sale-sys-office-prepare-update': {
    ...base('校验并准备机构扩展编辑提交草稿，不发PUT。', { shape: '{ draft: object }', fields: updateFields, empty: 'id、salesId、salesCode、salesType、salesParentId或salesStatus非法，或销售上级等于自身时抛错；不发送请求。' }, ['先调用get和候选树，用当前详情与用户确认后的字段准备草稿。', 'salesCode变更时先调用checkCode并确认返回true；用户确认后把同一draft交给update。', '用户取消时丢弃draft，不调用update。'], 'prepare'),
    inputs: { form: param('编辑弹窗表单。', 'sale-sys-office-get结果、候选树和用户明确修改', { type: 'object', required: true, constraints: ['form.salesCode、salesType、salesParentId、salesStatus为Portal必填；salesParentId不能等于salesId。', 'salesType=3时groupSalesAreaCodes和groupSalesBusinessCodes按value数组输入，提交时分别join为groupSalesAreaCodes和salesBusiness；其它类型省略这两个字段。', 'prepare阶段不发CRM编码校验；编码变更时由调用方显式先调用checkCode。'], source: '用户编辑表单' }) },
    steps: [
      { role: 'required', when: '开始编辑当前列表选中的机构', capabilityId: 'sale-sys-office-get', mapping: { id: 'user.id' }, instruction: '使用当前行id读取详情，不从列表展示字段猜测salesId或销售上级链。' },
      { role: 'required', when: 'salesCode发生变化', capabilityId: 'sale-sys-office-check-code', mapping: { code: 'user.form.salesCode', oldCode: 'user.detail.salesCode' }, instruction: '返回true才继续准备；返回false或请求失败时停止提交。' },
      { role: 'required', when: '用户确认编辑草稿', capabilityId: 'sale-sys-office-update', mapping: { draft: 'result.draft' }, instruction: '提交同一份草稿；不要把name、code、parentId、remarks或groupSalesBusinessCodes数组直接塞进PUT。' },
      { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不调用update。' },
    ],
  },
  'sale-sys-office-update': {
    ...base('提交用户确认的机构扩展编辑草稿。', { shape: 'undefined', fields: [field('$', 'undefined', '后端返回true后SDK返回undefined；不能把空回执当成编辑结果。')], empty: '响应不是true时抛错。' }, ['PUT只提交prepareUpdate整理出的字段；成功或超时后重新调用list和organizationTree，按同一id核对销售编码、类型、上级、状态和扩展字符串。'], 'write'),
    inputs: { draft: param('prepareUpdate返回的机构编辑草稿。', 'sale-sys-office-prepare-update.result.draft', { type: 'object', required: true, constraints: ['必须原样提交；不要重新加入Portal pick剔除的字段。'] }) },
    steps: [{ role: 'recovery', when: 'PUT成功、超时或响应丢失后核实', capabilityId: 'sale-sys-office-list', mapping: {}, instruction: '刷新列表并按draft.id/销售编码核对终态，同时刷新organizationTree；不确定时不要重复PUT。' }],
  },
  'sale-sys-office-prepare-stop': {
    ...base('准备单条停用机构扩展，不发PUT。', { shape: '{ id: string | number }', fields: [field('id', 'string | number', '当前列表记录机构ID。')], empty: 'currentFilterStatus不是1或id非法时抛错；不发送请求。' }, ['Portal只有列表筛选启用状态String(value)==="1"时显示停用；用户确认同一行后交给stop。'], 'prepare'),
    inputs: { id: idInput, currentFilterStatus: activeFilterInput },
    steps: [{ role: 'required', when: '用户明确确认单条停用且当前筛选状态为1', capabilityId: 'sale-sys-office-stop', mapping: { id: 'result.id' }, instruction: '提交同一机构ID；后端还会校验启用下级组织和用户等业务条件。' }, { role: 'cancel', when: '用户取消停用', instruction: '只丢弃id，不调用stop。' }],
  },
  'sale-sys-office-stop': {
    ...base('停用一条当前列表选中的机构扩展。', { shape: 'undefined', fields: [field('$', 'undefined', '后端返回true后SDK返回undefined。')], empty: '响应不是true时抛错。' }, ['请求固定PUT /admin-api/sales/organization/update，body只有id和salesStatus=2；成功或超时后重新查询列表和organizationTree核对状态及树节点。'], 'write'),
    inputs: { id: idInput },
    steps: [{ role: 'recovery', when: 'PUT成功、超时或响应丢失后核实', capabilityId: 'sale-sys-office-list', mapping: {}, instruction: '刷新列表并核对同一id的salesStatus；再刷新organizationTree，不把HTTP成功当作落库证据。' }],
  },
  'sale-sys-office-prepare-batch-stop': {
    ...base('准备批量停用用户勾选的机构扩展，不发POST。', { shape: '{ ids: (string | number)[] }', fields: [field('ids', '(string | number)[]', '去重后的当前列表选中机构ID数组。')], empty: 'currentFilterStatus不是1、ids为空或有重复/非法ID时抛错；不发送请求。' }, ['批量停用按钮只有在筛选状态为1且有勾选行时可用；用户确认后把同一ids交给batchStop。'], 'prepare'),
    inputs: { ids: idsParam, currentFilterStatus: activeFilterInput },
    steps: [{ role: 'required', when: '用户明确确认批量停用且当前筛选状态为1', capabilityId: 'sale-sys-office-batch-stop', mapping: { ids: 'result.ids' }, instruction: '提交JSON数组本身，不要包成{ids}对象。' }, { role: 'cancel', when: '用户取消批量停用', instruction: '只丢弃ids，不调用batchStop。' }],
  },
  'sale-sys-office-batch-stop': {
    ...base('批量停用用户勾选的机构扩展。', { shape: 'undefined', fields: [field('$', 'undefined', '后端返回true后SDK返回undefined。')], empty: '响应不是true时抛错。' }, ['请求固定POST /admin-api/sales/organization/batch-disable，JSON body是ID数组；成功或超时后重新查询列表和organizationTree逐项核对。'], 'write'),
    inputs: { ids: idsParam },
    steps: [{ role: 'recovery', when: 'POST成功、超时或响应丢失后核实', capabilityId: 'sale-sys-office-list', mapping: {}, instruction: '按每个ID刷新列表核对salesStatus=2；任一项不确定时报告部分结果，不盲目重发整批。' }],
  },
  'sale-sys-office-export': {
    ...base('按当前机构扩展筛选和分页导出机构Excel。', fileOutput, ['把返回的Base64按fileName保存或传输；文件内容来自当前筛选，SDK不会把token放进URL。']),
    inputs: listInputs,
  },
}

export const SALE_SYS_OFFICE_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALE_SYS_OFFICE_METHODS).map(id => [id, contracts[id]!]))
export const SALE_SYS_OFFICE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALE_SYS_OFFICE_METHODS).map(([id, method]) => [`saleSysOffice.${method}`, SALE_SYS_OFFICE_AI_CONTRACTS[id]!]))
