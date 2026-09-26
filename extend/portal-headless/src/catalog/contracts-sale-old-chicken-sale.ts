import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALE_OLD_CHICKEN_SALE_METHODS } from '../capabilities/sale-old-chicken-sale.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const pagePath = '/dashboard/sale/setting/old-chicken-sale/list'
const formPath = '/simple/sales/form/008'
const permission = '/dashboard/sale/setting/old-chicken-sale'
const setPricePermission = 'setting:old-chicken-sale:set-price-range'
const createPermission = 'setting:old-chicken-sale:create-sales-apply'
const detailPermission = 'setting:old-chicken-sale:detail-sales-apply'

const rowFields: AiField[] = [
  field('list[].id', 'string | number', '老母鸡销售申请主键；详情、删除和流程详情入口使用它。'),
  field('list[].salesCustomerCompanyName', 'string | null', '销售客户所属管控组织名称；只读展示。', { nullable: true }),
  field('list[].salesCategoryName', 'string | null', '后端补出的销售品类名称；只读展示。', { nullable: true }),
  field('list[].salesVarietyName', 'string | null', '销售品系字典的展示名称；只读展示，筛选提交salesVariety值。', { nullable: true }),
  field('list[].salesCustomerName', 'string | null', '销售客户/农场展示名称；只读展示。', { nullable: true }),
  field('list[].expectedSalesQuantity', 'number | null', '预计销售数量；Portal列标题单位kg。', { nullable: true, unit: 'kg' }),
  field('list[].expectedSalesNum', 'number | null', '预计销售只数；Portal列标题单位只。', { nullable: true, unit: '只' }),
  field('list[].eliminatedAge', 'number | null', '鸡群淘汰日龄；Portal列标题单位天。', { nullable: true, unit: '天' }),
  field('list[].maleAvgWeight', 'number | null', '公鸡平均体重；Portal列标题单位kg。', { nullable: true, unit: 'kg' }),
  field('list[].femaleAvgWeight', 'number | null', '母鸡平均体重；Portal列标题单位kg。', { nullable: true, unit: 'kg' }),
  field('list[].maleQuotePrice', 'number | null', '公鸡市场报价；Portal展示保留2位小数，单位元/kg。', { nullable: true, unit: '元/kg' }),
  field('list[].femaleQuotePrice', 'number | null', '母鸡市场报价；Portal展示保留2位小数，单位元/kg。', { nullable: true, unit: '元/kg' }),
  field('list[].applicantName', 'string | null', '申请人姓名；筛选条件applicantName按后端转为申请人ID。', { nullable: true }),
  field('list[].applyTime', 'string | null', '申请时间原值；只读展示。', { nullable: true }),
  field('list[].statusName', 'string | null', '申请状态展示名称；不能从名称反推可删除状态。', { nullable: true }),
  field('list[].processInstanceId', 'string | null', '流程实例ID；有值时Portal查看跳到通用流程详情，否则用008详情表单。', { nullable: true }),
]

const customerFields: AiField[] = [
  field('list[].id', 'string | number | null', '销售客户记录ID；仅作候选原值，提交使用customerId。', { nullable: true }),
  field('list[].salesCustomerCompanyId', 'string | null', '选中客户对应的管控组织ID；填入申请salesCustomerCompanyId。', { nullable: true }),
  field('list[].salesCustomerCompanyName', 'string | null', '选中客户对应的管控组织名称；填入申请salesCustomerCompanyName。', { nullable: true }),
  field('list[].farmName', 'string | null', '客户农场/销售客户名称；填入申请salesCustomerName。', { nullable: true }),
  field('list[].customerId', 'string | null', '销售客户业务ID；填入申请salesCustomer，不能用farmName代替。', { nullable: true }),
  field('list[].mobilePhone', 'string | null', '客户手机号展示值；可作为下一次关键词。', { nullable: true }),
]

const configFields: AiField[] = [
  field('salesQuantity', 'integer', '预计销售数量与订单销售数量的差值；Portal输入范围0~1000000整数，后端实际保存上限99999，单位kg。', { unit: 'kg', constraints: ['SDK按后端有效上限99999拒绝超限值。'] }),
  field('malePriceMin', 'number | null', '公鸡销售单价低于报价的差值；空值表示不设置，保存后端默认值可能回读为0，单位元/kg。', { nullable: true, unit: '元/kg' }),
  field('malePriceMax', 'number | null', '公鸡销售单价高于报价的差值；非空时不能小于malePriceMin，单位元/kg。', { nullable: true, unit: '元/kg' }),
  field('femalePriceMin', 'number | null', '母鸡销售单价低于报价的差值；空值表示不设置，保存后端默认值可能回读为0，单位元/kg。', { nullable: true, unit: '元/kg' }),
  field('femalePriceMax', 'number | null', '母鸡销售单价高于报价的差值；非空时不能小于femalePriceMin，单位元/kg。', { nullable: true, unit: '元/kg' }),
  field('expectedSaleDateMaxRange', 'integer', '预计销售起止日期允许的最长天数；Portal显示单位天，后端要求大于0。', { unit: '天' }),
]

const applicationFields: AiField[] = [
  field('id', 'string | number', '申请主键；删除、回查和流程业务key使用。'),
  field('applicantId', 'string | number | null', '申请人用户ID；创建时必须是当前用户能代表的用户，删除时后端校验当前登录人是申请人。', { nullable: true }),
  field('applicantName', 'string | null', '申请人姓名快照；Portal从当前用户预填，不能为空。', { nullable: true }),
  field('salesCustomerCompanyId', 'string | null', '选中销售客户所属管控组织ID；来自customer-search候选。', { nullable: true }),
  field('salesCustomerCompanyName', 'string | null', '管控组织展示快照；PC表单必填，不能只传名称不传ID。', { nullable: true }),
  field('factoryId', 'string | number | null', '管控工厂组织ID；来自organization-tree，Portal只允许选择isStandardUnit=1节点。', { nullable: true }),
  field('salesVariety', 'string | null', '销售品系字典value；可空，候选来自visit_record_related_varieties。', { nullable: true }),
  field('salesCustomer', 'string | null', '销售客户业务ID；来自customer-search.customerId。', { nullable: true }),
  field('salesCustomerName', 'string | null', '销售客户/农场名称展示快照。', { nullable: true }),
  field('expectedSalesQuantity', 'number | null', '预计销售数量；页面要求整数且至少1，单位kg。', { nullable: true, unit: 'kg' }),
  field('expectedSalesNum', 'number | null', '销售只数；后端@NotNull，页面输入要求整数且至少1，单位只。', { nullable: true, unit: '只' }),
  field('eliminatedAge', 'number | null', '鸡群日龄；页面要求整数且至少1，单位天。', { nullable: true, unit: '天' }),
  field('maleAvgWeight', 'number | null', '公鸡平均体重；页面要求至少1且最多2位小数，单位kg。', { nullable: true, unit: 'kg' }),
  field('femaleAvgWeight', 'number | null', '母鸡平均体重；页面要求至少1且最多2位小数，单位kg。', { nullable: true, unit: 'kg' }),
  field('maleQuotePrice', 'number | null', '公鸡市场报价；页面要求至少1且最多2位小数，单位元/kg。', { nullable: true, unit: '元/kg' }),
  field('femaleQuotePrice', 'number | null', '母鸡市场报价；页面要求至少1且最多2位小数，单位元/kg。', { nullable: true, unit: '元/kg' }),
  field('expectedSaleStartDate', 'string | null', '预计销售开始日期；YYYY-MM-DD，来自PC的expectedSaleDateRange[0]。', { nullable: true, format: 'YYYY-MM-DD' }),
  field('expectedSaleEndDate', 'string | null', '预计销售结束日期；YYYY-MM-DD，不能早于开始日期。', { nullable: true, format: 'YYYY-MM-DD' }),
  field('applyReason', 'string | null', '申请原因；可空，SDK按移动端与后端有效上限200字符校验；PC源码maxlength为500但后端DTO为200。', { nullable: true, constraints: ['最多200字符。'] }),
  field('attachments', 'object[]', '已上传OSS资源；每项至少保留url和name，申请页可为空。'),
  field('processInstanceId', 'string | null', '流程实例ID；有值时应交给通用流程详情能力，不能用申请ID冒充。', { nullable: true }),
]

const configOutput: AiContract['output'] = { shape: 'object', fields: configFields, empty: '配置缺失或字段类型/范围不合法时抛错，不伪造默认表单。' }
const trueOutput: AiContract['output'] = { shape: 'boolean', fields: [field('$', 'boolean', 'Java保存/删除接口的业务回执；SDK只接受true。', { values: { true: '后端接受请求' } })], empty: '返回false、缺失或其它值时抛错；true仍需回查。' }
const pageOutput: AiContract['output'] = { shape: '{ list: object[], total: number }', fields: [field('$', 'object', '老母鸡销售申请分页结果。'), field('list', 'object[]', '当前页申请，不是全量结果。'), field('total', 'number', '符合筛选条件的总数，用于翻页。'), ...rowFields], empty: 'list=[]表示当前页无记录；total=0才表示没有匹配记录。' }
const customerOutput: AiContract['output'] = { shape: '{ list: object[], total: number }', fields: [field('$', 'object', '销售客户分页候选。'), field('list', 'object[]', '当前关键词命中的客户候选。'), field('total', 'number', '候选总数。'), ...customerFields], empty: '没有候选时list=[]；未提供farmName或mobilePhone时SDK在请求前拒绝，避免照抄Portal的无关键词全量查询。' }
const treeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('[]', 'object', '角色可见的组织树节点。'), field('[].id', 'string | number', '组织节点ID；选为factoryId。'), field('[].name', 'string', '组织节点名称。'), field('[].isStandardUnit', 'number', '组织节点是否为标准单位；Portal role-org与移动端树将值为0的节点置为不可选，值为1的节点可选。'), field('[].children', 'object[]', '子组织节点，结构同节点。')],
  empty: '没有可见组织时返回[]；不能把标准单位节点当作可提交工厂。',
}
const detailOutput: AiContract['output'] = { shape: 'object', fields: applicationFields, empty: '申请不存在或详情字段不合法时抛错，不返回空申请。' }
const customerIdInput = param('销售客户搜索关键词。', '用户输入；至少提供farmName或mobilePhone之一', { type: 'string', required: false, constraints: ['Portal客户弹窗实际同时允许空查询；SDK要求至少一个关键词以避免几千条候选被无头调用方一次拉取。'] })
const configFormInput = param('价格管控页面表单。', 'sale-old-chicken-sale-get-control-config.result或用户修改后的表单', { type: 'object', required: true, constraints: ['salesQuantity为0~99999整数；价格为空或0.01~100且最多2位小数；同一性别的max不能小于min；expectedSaleDateMaxRange为大于0的整数。'] })
const configDraftInput = param('prepareControlConfig返回的草稿。', 'sale-old-chicken-sale-prepare-control-config.result.draft', { type: 'object', required: true, constraints: ['用户确认后原样交给saveControlConfig；取消只丢弃草稿。'] })
const applicationFormInput = param('008老母鸡销售申请表单。', '用户输入、customer-search候选、organization-tree和当前用户上下文', { type: 'object', required: true, constraints: ['申请人、管控组织、工厂、客户、数量/只数、日龄、四个重量/报价和日期必填；日期可传PC的expectedSaleDateRange，也可直接传expectedSaleStartDate/expectedSaleEndDate；applyReason最多200字符。', 'factoryId应来自组织树且只能选择isStandardUnit=1节点；salesCustomerCompanyId/salesCustomer/salesCustomerName应来自同一客户候选。'] })
const applicationDraftInput = param('prepareCreate返回的最终请求草稿。', 'sale-old-chicken-sale-prepare-create.result.draft', { type: 'object', required: true, constraints: ['不要重新把expectedSaleDateRange放回请求体；create只发送起止日期和后端DTO字段。'] })
const idInput = param('当前列表明确选定的申请ID。', 'sale-old-chicken-sale-list.list[].id或sale-old-chicken-sale-get.id', { type: 'string | number', required: true, constraints: ['不能用客户ID、流程实例ID或名称替代。'] })
const gaps = ['尚未在真实测试环境执行本页列表、价格管控读取/保存、008申请提交、详情和删除及写入后的独立回查；当前证据来自Portal源码、Java源码和离线请求断言。']

function base (purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      `只覆盖门户“系统设置→销售设置→老母鸡销售”列表页${pagePath}及其可达的价格管控页和流程表单${formPath}；不是独立生产菜单。`,
      `列表权限是${permission}；设置价格区间、创建申请、查看分别受${setPricePermission}、${createPermission}、${detailPermission}控制；删除按钮在Portal源码中没有buttonPermissionFlag，仍由后端当前用户、状态和流程约束裁决。`,
      '所有本页请求使用Portal platform实例并按销售模块带module-type=60；销售品系使用已有visit_record_related_varieties字典，不在本能力中伪造枚举。',
      '客户候选来自Portal的销售客户分页接口；这是长选项，SDK要求先给农场名或手机号关键字。组织树保留isStandardUnit=0/1，Portal只允许选择值为1的节点，SDK不替调用方越过页面禁选规则。',
      '申请create会启动eliminated_chicken_sales_apply流程；成功回执是后端返回的业务ID，不等于审批通过。运行中的申请不能从本列表删除，删除权限和状态由后端再次校验。',
    ],
    effect,
    prerequisites: ['使用绑定当前用户、租户、会话token和platform base URL的SDK；组织、客户、申请ID和价格/申请字段必须来自当前可见页面数据或用户明确输入。'],
    inputs: {},
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? 'Promise完成只表示响应通过校验；写操作成功或超时后必须按ID或配置重新读取核对，不能只看成功提示。' : effect === 'prepare' ? '得到无副作用草稿，尚未发送写请求；用户取消只丢弃草稿。' : '返回通过结构校验的页面数据。',
    failures: ['非法分页、关键词、日期、ID、价格、申请表单或响应形状在请求前失败；权限、租户、网络、流程和后端业务错误原样抛出。', 'SDK不把PC申请原因maxlength=500误当成后端可接受长度，最终按移动端/后端200字符限制。'],
    idempotency: effect === 'write' ? '后端没有requestId；create超时先用申请列表/详情按业务字段回查，不盲目重复启动流程；保存配置和删除同样先回查。' : null,
    evidence: [
      { source: 'CodeReview_Projects_Js@test/portal/main: app/portal/menus/sale.js:198、app/portal/views/dashboard/sale/setting/old-chicken-sale/list.vue、[mode]/[id].vue、simple/sales/form/008/page/pc/edit/index.vue、simple/sales/form/008/page/mobile/edit/index.vue、simple/sales/form/008/page/pc/detail/index.vue、simple/sales/form/008/page/mobile/detail/index.vue、visit/.../ModalCustomerList.vue', kind: 'reference', note: '证明菜单归属、列表筛选/权限/删除、价格管控表单、008申请字段转换、PC与移动端校验、详情入口、客户候选和组织树请求。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-sales/.../EliminatedChickenSalesApplyController.java、.../EliminatedChickenSalesApplyServiceImpl.java、.../vo/EliminatedChickenSalesApplySaveReqVO.java、.../EliminatedChickenControlConfigSaveReqVO.java、.../EliminatedChickenControlConfigServiceImpl.java', kind: 'reference', note: '证明申请create/get/page/delete、流程启动、当前用户删除约束、价格配置后端范围及日期区间校验。' },
      { source: 'src/capabilities/sale-old-chicken-sale.ts 与 test/sale-old-chicken-sale.test.ts', kind: 'test', note: '锁定列表参数、platform/module-type、客户关键词、价格和申请表单校验、prepare→submit→cancel分支及坏回执；不替代真实环境验证。' },
      { source: 'docs/pages/老母鸡销售.md', kind: 'reference', note: '记录本页四件套、PC/移动端差异和真实环境缺口。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'sale-old-chicken-sale-list': {
    ...base('分页查询老母鸡销售申请列表。', pageOutput, ['用list[].id调用get或prepare-remove；有processInstanceId的查看动作交给通用流程详情能力，没有的用本能力get回查008详情。', '销售品系筛选值来自已有字典；applyTimeRange会转换为applyTimeStart/applyTimeEnd。']),
    inputs: {
      pageNo: param('从1开始的页码。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认1' }),
      pageSize: param('每页条数。', '调用方分页状态；Portal styleV2默认20', { type: 'integer', required: false, default: 'SDK默认20', constraints: ['接受10/20/50/100。'] }),
      salesVariety: param('销售品系字典value。', 'base-dict-get(dictType="visit_record_related_varieties").entries[].value或用户明确选择', { type: 'string | null', required: false, nullable: true }),
      orgId: param('申请组织ID。', 'Portal销售组织树选择结果', { type: 'string | number | null', required: false, nullable: true }),
      applicantName: param('申请人姓名关键字。', '用户输入', { type: 'string | null', required: false, nullable: true }),
      applyTimeRange: param('申请时间闭区间。', 'Portal日期范围选择器', { type: '[string, string] | [] | null', required: false, nullable: true, format: 'YYYY-MM-DD', constraints: ['传两端时SDK改发applyTimeStart/applyTimeEnd；结束日不能早于开始日。'] }),
    },
  },
  'sale-old-chicken-sale-customer-search': {
    ...base('按关键字搜索008申请表单可选的销售客户。', customerOutput, ['从list[].customerId、salesCustomerCompanyId、salesCustomerCompanyName、farmName组成同一份申请表单，不能跨候选拼接ID和名称。']),
    inputs: {
      farmName: { ...customerIdInput, meaning: '农场名/销售客户名关键字。' },
      mobilePhone: { ...customerIdInput, meaning: '客户手机号关键字。' },
      pageNo: param('从1开始的候选页码。', '客户弹窗分页状态', { type: 'integer', required: false, default: 'SDK默认1' }),
      pageSize: param('候选每页条数。', '客户弹窗分页状态', { type: 'integer', required: false, default: 'SDK默认20', constraints: ['接受10/20/50/100。'] }),
    },
  },
  'sale-old-chicken-sale-organization-tree': {
    ...base('读取008申请表单可见的管控工厂组织树。', treeOutput, ['只从节点id选择factoryId；按Portal规则禁用isStandardUnit=0的节点，只从isStandardUnit=1节点选择，保留父子层级。']),
    inputs: {},
  },
  'sale-old-chicken-sale-get-control-config': {
    ...base('读取老母鸡销售价格和预计销售日期管控配置。', configOutput, ['把结果作为prepareControlConfig的初始form；价格回读为0时按后端默认的未设置值理解，不直接当作0.01。']),
    inputs: {},
  },
  'sale-old-chicken-sale-prepare-control-config': {
    ...base('按Portal价格管控表单和后端边界整理保存草稿，不发送save。', { shape: '{ draft: object }', fields: configFields.map(item => ({ ...item, path: `draft.${item.path}` })), empty: '表单不完整、价格关系不合法或日期范围非正整数时抛错。' }, ['用户明确确认后把同一draft交给saveControlConfig；取消只丢弃草稿。'], 'prepare'),
    inputs: { form: configFormInput },
    steps: [
      { role: 'required', when: '开始修改价格管控', capabilityId: 'sale-old-chicken-sale-get-control-config', mapping: {}, instruction: '读取当前配置再编辑，不凭空覆盖其它字段。' },
      { role: 'required', when: '用户明确确认保存', capabilityId: 'sale-old-chicken-sale-save-control-config', mapping: { draft: 'result.draft' }, instruction: '提交同一份价格管控草稿。' },
      { role: 'cancel', when: '用户取消保存', instruction: '丢弃draft，不调用saveControlConfig。' },
    ],
  },
  'sale-old-chicken-sale-save-control-config': {
    ...base('保存用户确认的老母鸡价格和日期管控配置。', trueOutput, ['返回true后调用getControlConfig逐字段核对；后端将null价格规范化为0，不能把0误报成业务填写了零差值。'], 'write'),
    inputs: { draft: configDraftInput },
    steps: [{ role: 'recovery', when: '保存返回true、超时或响应丢失后核实', capabilityId: 'sale-old-chicken-sale-get-control-config', mapping: {}, instruction: '重新读取配置并逐字段核对；失败或超时不要盲目重复保存。' }],
  },
  'sale-old-chicken-sale-get': {
    ...base('读取一条老母鸡销售申请详情。', detailOutput, ['用于008详情展示或在创建/删除后按同一ID回查；processInstanceId有值时流程详情另交给通用流程能力。']),
    inputs: { id: idInput },
  },
  'sale-old-chicken-sale-prepare-create': {
    ...base('按PC/移动端008申请表单、后端DTO和页面提交转换整理创建草稿，不发送create。', { shape: '{ draft: object }', fields: applicationFields.map(item => ({ ...item, path: `draft.${item.path}` })), empty: '必填字段、日期、数量、金额、原因长度或附件结构不合法时抛错。' }, ['先通过customer-search和organization-tree取得同一客户/可选工厂，再让用户确认；取消只丢弃draft。', 'PC的expectedSaleDateRange在准备阶段转换为expectedSaleStartDate和expectedSaleEndDate；create请求不发送expectedSaleDateRange。'], 'prepare'),
    inputs: { form: applicationFormInput },
    steps: [
      { role: 'optional', when: '需要选择销售客户', capabilityId: 'sale-old-chicken-sale-customer-search', mapping: {}, instruction: '先给farmName或mobilePhone关键字，从同一候选填充客户ID、客户组织ID和展示名称。' },
      { role: 'required', when: '需要选择管控工厂', capabilityId: 'sale-old-chicken-sale-organization-tree', mapping: {}, instruction: '从可见树中选择非标准单位节点的id。' },
      { role: 'optional', when: '需要确认预计销售日期是否超出配置', capabilityId: 'sale-old-chicken-sale-get-control-config', mapping: {}, instruction: '按返回expectedSaleDateMaxRange核对日期天数，后端最终仍会校验。' },
      { role: 'required', when: '用户明确确认提交申请', capabilityId: 'sale-old-chicken-sale-create', mapping: { draft: 'result.draft' }, instruction: '提交同一份草稿；创建会启动审批流程，不代表审批通过。' },
      { role: 'cancel', when: '用户取消申请', instruction: '丢弃draft，不调用create，也不启动流程。' },
    ],
  },
  'sale-old-chicken-sale-create': {
    ...base('提交一条用户确认的老母鸡销售审批申请并启动流程。', { shape: 'string | number', fields: [field('$', 'string | number', '后端创建返回的申请业务ID；用于详情、列表回查和流程业务key。')], empty: '返回ID非法或响应失败时抛错；不把成功提示当作审批通过。' }, ['创建返回ID后立即用get或list按业务字段回查；若流程状态需要观察，使用通用流程能力查看审批状态。'], 'write'),
    inputs: { draft: applicationDraftInput },
    steps: [
      { role: 'recovery', when: 'create返回ID、超时或响应丢失后核实', capabilityId: 'sale-old-chicken-sale-get', mapping: { id: 'result.$' }, instruction: '读取同一申请ID，核对客户、工厂、数量、日期和附件；超时无法定位时停止重复提交。' },
    ],
  },
  'sale-old-chicken-sale-prepare-remove': {
    ...base('准备删除当前列表明确选定的老母鸡销售申请，不发送DELETE。', { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待用户确认的申请ID；删除只针对这条记录。')], empty: 'ID非法时抛错且不发送DELETE。' }, ['先展示目标申请的客户、金额、状态并取得明确确认；Portal列表删除按钮没有前端按钮权限判断，后端仍会校验申请人和状态。'], 'prepare'),
    inputs: { id: idInput },
    steps: [
      { role: 'required', when: '用户明确确认删除', capabilityId: 'sale-old-chicken-sale-remove', mapping: { id: 'result.id' }, instruction: '提交同一申请ID；运行中/已通过或非本人申请可能被后端拒绝。' },
      { role: 'cancel', when: '用户取消删除', instruction: '丢弃删除草稿，不发送DELETE。' },
    ],
  },
  'sale-old-chicken-sale-remove': {
    ...base('删除一条满足后端状态和归属约束的老母鸡销售申请。', trueOutput, ['返回true后刷新list并确认同一ID消失；若返回业务错误，保留原记录并提示后端状态/归属限制。'], 'write'),
    inputs: { id: idInput },
    steps: [{ role: 'recovery', when: 'remove返回true、超时或响应丢失后核实', capabilityId: 'sale-old-chicken-sale-list', mapping: {}, instruction: '刷新当前筛选列表，确认目标ID不再出现；超时先回查，不盲目重删。' }],
  },
}

export const SALE_OLD_CHICKEN_SALE_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALE_OLD_CHICKEN_SALE_METHODS).map(id => [id, contracts[id]!]))
export const SALE_OLD_CHICKEN_SALE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALE_OLD_CHICKEN_SALE_METHODS).map(([id, method]) => [`saleOldChickenSale.${method}`, SALE_OLD_CHICKEN_SALE_AI_CONTRACTS[id]!]))
