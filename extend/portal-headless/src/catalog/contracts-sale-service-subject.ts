import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALE_SERVICE_SUBJECT_METHODS } from '../capabilities/sale-service-subject.js'

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })

const pagePath = '/dashboard/sale/setting/service-subject/list'
const pagePermission = '/dashboard/sale/setting/service-subject'
const createPermission = 'sales:setting:service-subject:create'
const editPermission = 'sales:setting:service-subject:edit'
const deletePermission = 'sales:setting:service-subject:delete'

const rowFields: AiField[] = [
  field('list[].id', 'string | number | null', '服务主体列表记录ID；编辑、删除的目标标识，不是客户分类值', { nullable: true, nullMeaning: '当前行没有可操作ID，不能继续编辑或删除' }),
  field('list[].name', 'string | null', '服务主体名称；列表主体名称列', { nullable: true, nullMeaning: '页面行未返回主体名称' }),
  field('list[].parentId', 'string | number | null', '上级组织标识；只有表单详情或后端扩展返回时可用', { optional: true, nullable: true, nullMeaning: '页面列表通常不展示上级组织' }),
  field('list[].customerType', 'string | number | null', '客户分类原始值；列表客户分类列，不把值强行翻译成其它字典', { nullable: true, nullMeaning: '页面行未返回客户分类' }),
  field('list[].updateTime', 'string | number | null', '页面更新时间列的原始值；SDK不换算时区或格式', { optional: true, nullable: true, nullMeaning: '服务端使用其它时间字段或未返回更新时间' }),
  field('list[].updateDate', 'string | number | null', 'HR角色接口可能返回的更新时间原始字段；不能与页面列名updateTime混为一谈', { optional: true, nullable: true, nullMeaning: '服务端未返回该兼容字段' }),
]

const formFields = (prefix: string): AiField[] => [
  field(`${prefix}.parentId`, 'string | number', '“上级组织”选择值；Portal表单只要求非空，SDK不猜组织树或客户分类的编码规则'),
  field(`${prefix}.name`, 'string', '服务主体名称；Portal表单只要求非空，保留用户输入原值'),
  field(`${prefix}.customerType`, 'string | number', '“客户分类”选择值；Portal表单只要求非空，选项数组当前为空，不能凭空补字典映射'),
]

const subjectFields = formFields('')
  .map(item => ({ ...item, path: item.path.replace(/^\./, '') }))

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', '设置服务主体分页结果'),
    field('list', 'object[]', '当前页服务主体记录，不是全量结果'),
    field('total', 'number', '符合当前分页查询条件的总记录数，用于继续翻页'),
    ...rowFields,
  ],
  empty: 'list=[]表示当前页没有记录；total=0才表示当前查询无记录，权限、租户、网络或后端错误会抛异常。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: [field('$', 'object', 'Portal编辑页按objectURL读取的表单详情'), ...subjectFields, field('id', 'string | number | null', '编辑加载目标ID；由详情响应决定是否回显到提交表单', { optional: true, nullable: true, nullMeaning: '旧表单详情没有回显ID；更新时仍必须使用当前列表目标ID' })],
  empty: '详情响应不是对象或字段无法理解时抛异常，不把空对象解释为可编辑表单。',
}

const createDraftFields: AiField[] = [
  field('$', 'object', '新增服务主体准备结果'),
  field('draft', 'object', '确认前的无副作用新增草稿'),
  ...formFields('draft'),
]
const updateDraftFields: AiField[] = [
  field('$', 'object', '编辑服务主体准备结果'),
  field('draft', 'object', '确认前的无副作用编辑草稿'),
  field('draft.id', 'string | number', '当前编辑目标服务主体ID；来源必须是当前列表行或详情目标', { source: 'sale-service-subject-list.list[].id或sale-service-subject-get.id' }),
  ...formFields('draft'),
]

const trueVoidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', 'Portal表单提交或删除成功时没有业务返回值；不能从空回执推导新ID或删除条数')],
  empty: 'Promise正常完成表示请求被Portal响应拦截器判定成功；业务记录仍需列表回查。',
}

const removePreparationOutput: AiContract['output'] = {
  shape: '{ id: string | number }',
  fields: [field('$', 'object', '删除准备结果'), field('id', 'string | number', '待用户确认删除的服务主体ID')],
  empty: 'ID非法时准备阶段抛异常，不发送DELETE。',
}

const listInputs: Record<string, AiParameter> = {
  order: param('Portal公共列表排序方向字段。页面没有排序控件，默认发送空字符串。', 'Portal useListPageModule内部排序状态', { type: 'string', required: false, omitted: 'SDK补空字符串；不要据此推断页面支持排序交互' }),
  orderField: param('Portal公共列表排序字段。页面没有排序控件，默认发送空字符串。', 'Portal useListPageModule内部排序状态', { type: 'string', required: false, omitted: 'SDK补空字符串；不要自行猜字段名' }),
  pageNo: param('从1开始的页码。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认1', constraints: ['必须是正整数。'] }),
  limit: param('每页记录数；这是Portal公共列表配置实际发送的`limit`键，不是pageSize。', 'Portal分页控件，styleV2默认20', { type: 'integer', required: false, default: 'SDK默认20', constraints: ['只接受10、20、50或100。'] }),
}

const idInput = param('当前用户可见的服务主体记录ID。', 'sale-service-subject-list.list[].id，或编辑路由使用的同一目标ID', { type: 'string | number', required: true, constraints: ['必须是正整数；不能用名称或customerType替代。'] })
const formInputs: Record<string, AiParameter> = {
  parentId: param('上级组织选择值。', '用户在Portal“上级组织”选择框中的选择', { type: 'string | number', required: true, constraints: ['Portal仅做必填校验；当前页面options为空，不能由SDK猜测组织候选。'] }),
  name: param('服务主体名称。', '用户输入', { type: 'string', required: true, constraints: ['Portal仅拒绝空字符串；保留非空用户输入，不擅自trim或增加长度规则。'] }),
  customerType: param('客户分类选择值。', '用户在Portal“客户分类”选择框中的选择', { type: 'string | number', required: true, constraints: ['Portal仅做必填校验；当前页面options为空，不能把其它销售客户性质字典硬套进来。'] }),
}

const gaps = [
  '当前仅有Portal源码和固定Java源码基准，尚未在真实测试环境执行本页列表、编辑加载、创建、编辑、删除及写后回查。',
  'Portal表单的objectURL/customSubmit分别指向/admin-api/dict/type和/admin-api/customerType；固定test/test Java源码可见HrRoleController的page/get/delete，但未找到customerType表单路由及customerType字段的对应DTO。SDK保留Portal实际请求链，不把该缺口伪装成hr-role标准保存接口。',
]

function base (purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      `只覆盖门户“系统设置→销售设置→设置服务主体”页面${pagePath}及其可达的列表、编辑加载、提交和删除动作；不覆盖独立销售系统菜单。`,
      `页面入口受${pagePermission}控制；新增、编辑、删除按钮分别受${createPermission}、${editPermission}、${deletePermission}控制。SDK携带权限元数据，不在本地伪造权限判断，后端拒绝原样抛出。`,
      '请求使用Portal platform实例和销售页面module-type=60；列表不额外补useSystem，保持页面实际参数。',
      '页面列表/删除使用system/hr-role路径，而表单加载和新增/编辑使用旧dict/type、customerType路径；这是源码事实，不能为了接口命名一致而改成hr-role标准CRUD。',
    ],
    effect,
    prerequisites: ['SDK已绑定当前用户、租户、会话token和platform base URL；写操作的ID和选择值必须来自当前用户可见页面或用户明确输入。'],
    inputs: {},
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? 'Promise完成只表示Portal请求成功；必须刷新服务主体列表核对实际记录，不能把空回执当成创建ID或删除证据。' : effect === 'prepare' ? '得到无副作用的确认草稿；用户取消时不发送业务请求。' : '返回通过结构校验的当前页面数据或编辑底稿。',
    failures: ['参数缺失、分页非法或响应结构不符时在请求前/响应后失败；权限、租户、网络和后端业务错误原样抛出，不把错误当空列表。', '创建/编辑超时或响应丢失时结果不确定，先刷新列表核实，再决定是否重试。'],
    idempotency: effect === 'write' ? '页面请求没有requestId或SDK防重包装；创建可能重复，编辑/删除可能已生效。超时先按同一ID或表单关键字段回查，禁止盲目重发。' : null,
    evidence: [
      { source: 'CodeReview_Projects_Js@test/portal/main: app/portal/menus/sale.js:213、app/portal/views/dashboard/sale/setting/service-subject/list.vue、app/portal/views/dashboard/sale/setting/service-subject/[mode]/[id].vue', kind: 'reference', note: '证明菜单路径/权限、列表limit参数、hr-role分页/删除、表单字段、objectURL、customSubmit和按钮权限。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-system/.../HrRoleController.java、vo/role/HrRoleSaveReqVO.java、vo/role/HrRolePageReqVO.java', kind: 'reference', note: '证明现有hr-role page/get/delete路由及Java请求字段；不证明Portal旧customerType保存路由存在。' },
      { source: 'src/capabilities/sale-service-subject.ts 与 test/sale-service-subject.test.ts', kind: 'test', note: '锁定Portal请求方法、URL、limit、表单必填、权限元数据和prepare确认链；不替代真实环境写入验证。' },
      { source: 'docs/pages/设置服务主体.md', kind: 'reference', note: '记录逐字段基准、实际请求链、权限边界和未验证缺口。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'sale-service-subject-list': {
    ...base('查询设置服务主体页面的分页列表，保留页面主体名称、客户分类、更新时间和可操作ID。', listOutput, ['展示当前页list；total大于当前页长度时继续递增pageNo并保留limit，不能把一页当成全量。', '用户要编辑或删除时使用同一行的list[].id，不能用name或customerType代替。']),
    inputs: listInputs,
  },
  'sale-service-subject-get': {
    ...base('读取编辑路由使用的服务主体表单详情；它复现Portal objectURL，不是hr-role/get的替代名称。', detailOutput, ['把返回的parentId、name和customerType作为编辑初始值；若字段缺失，向用户补齐而不是猜测。', '编辑提交时仍把当前列表/路由目标ID明确交给prepareUpdate。']),
    inputs: { id: idInput },
  },
  'sale-service-subject-prepare-create': {
    ...base('校验并准备新增服务主体草稿，不发送Portal POST。', { shape: '{ draft: object }', fields: createDraftFields, empty: 'parentId、name或customerType为空时抛异常，且不发送请求。' }, ['向用户展示三项表单值并取得明确确认；当前页面选择项为空时不能替用户选择组织或客户分类。'], 'prepare'),
    inputs: formInputs,
    steps: [
      { role: 'required', when: '用户明确确认新增且草稿三项均已填写', capabilityId: 'sale-service-subject-create', mapping: { parentId: 'result.draft.parentId', name: 'result.draft.name', customerType: 'result.draft.customerType' }, instruction: '提交同一份draft；Portal新增和编辑共用POST /admin-api/customerType。' },
      { role: 'cancel', when: '用户取消新增', instruction: '只丢弃draft，不调用create。' },
    ],
  },
  'sale-service-subject-create': {
    ...base('提交用户确认的新增服务主体表单。', trueVoidOutput, ['Portal成功响应不返回新建ID；提交后刷新sale-service-subject-list，按用户确认的表单值核对新记录，不能凭空构造ID。'], 'write'),
    inputs: formInputs,
    steps: [{ role: 'recovery', when: 'POST成功、超时或响应丢失后核实', capabilityId: 'sale-service-subject-list', mapping: {}, instruction: '刷新列表并核对名称、上级组织和客户分类；无法唯一定位时先报告不确定，不重复创建。' }],
  },
  'sale-service-subject-prepare-update': {
    ...base('校验并准备编辑服务主体草稿，不发送Portal POST。', { shape: '{ draft: object }', fields: updateDraftFields, empty: 'id、parentId、name或customerType非法时抛异常，且不发送请求。' }, ['先用get按同一ID读取编辑底稿；确认修改目标和新值后再准备草稿。', '编辑草稿保留id，但不把详情中的更新时间或其它只读扩展字段拼进提交体。'], 'prepare'),
    inputs: { id: idInput, ...formInputs },
    steps: [
      { role: 'required', when: '开始编辑当前列表选定的服务主体', capabilityId: 'sale-service-subject-get', mapping: { id: 'user.id' }, instruction: '使用同一ID读取Portal objectURL表单详情；详情字段缺失时向用户补问。' },
      { role: 'required', when: '用户明确确认编辑且草稿校验通过', capabilityId: 'sale-service-subject-update', mapping: { id: 'result.draft.id', parentId: 'result.draft.parentId', name: 'result.draft.name', customerType: 'result.draft.customerType' }, instruction: '提交同一份draft；Portal仍使用POST /admin-api/customerType，不改成PUT hr-role/update。' },
      { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不调用update。' },
    ],
  },
  'sale-service-subject-update': {
    ...base('提交用户确认的编辑服务主体表单；按Portal源码使用POST而不是PUT。', trueVoidOutput, ['提交后刷新列表并按同一ID核对终态；空回执不代表HR角色或customerType数据已经可见。'], 'write'),
    inputs: { id: idInput, ...formInputs },
    steps: [{ role: 'recovery', when: 'POST成功、超时或响应丢失后核实', capabilityId: 'sale-service-subject-list', mapping: {}, instruction: '刷新列表并按提交前同一ID核对名称和客户分类；不确定时不要盲目重复POST。' }],
  },
  'sale-service-subject-prepare-remove': {
    ...base('准备删除当前列表中用户选定的一条服务主体，不发送DELETE。', removePreparationOutput, [`仅在用户拥有${deletePermission}且明确确认当前列表记录后继续；子角色或后端业务约束可能拒绝删除。`], 'prepare'),
    inputs: { id: idInput },
    steps: [
      { role: 'required', when: '用户明确确认删除', capabilityId: 'sale-service-subject-remove', mapping: { id: 'result.id' }, instruction: '提交同一列表记录ID；成功或超时后刷新列表核实。' },
      { role: 'cancel', when: '用户取消删除', instruction: '丢弃id，不发送DELETE。' },
    ],
  },
  'sale-service-subject-remove': {
    ...base('删除当前列表中用户确认的一条服务主体。', trueVoidOutput, ['返回成功后刷新列表，确认同一ID不再出现；如果存在子角色或权限不足，保留后端错误并向用户说明。'], 'write'),
    inputs: { id: idInput },
    steps: [{ role: 'recovery', when: 'DELETE成功、超时或响应丢失后核实', capabilityId: 'sale-service-subject-list', mapping: {}, instruction: '刷新列表核对目标ID是否消失；仍出现时视为未核实，不自动重删。' }],
  },
}

export const SALE_SERVICE_SUBJECT_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALE_SERVICE_SUBJECT_METHODS).map(id => [id, contracts[id]!]))
export const SALE_SERVICE_SUBJECT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALE_SERVICE_SUBJECT_METHODS).map(([id, method]) => [`saleServiceSubject.${method}`, SALE_SERVICE_SUBJECT_AI_CONTRACTS[id]!]))
