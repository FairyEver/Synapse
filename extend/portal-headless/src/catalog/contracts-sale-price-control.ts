import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALE_PRICE_CONTROL_METHODS } from '../capabilities/sale-price-control.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const pagePath = '/dashboard/sale/setting/price-control/list'
const formPath = '/simple/sales/form/005'
const pagePermission = '/dashboard/sale/setting/price-control'
const applyPermission = 'setting:price-control:guide-apply:apply'
const viewPermission = 'setting:price-control:guide-apply:view'
const withdrawPermission = 'setting:price-control:guide-apply:withdraw'
const resubmitPermission = 'setting:price-control:guide-apply:resubmit'
const voidPermission = 'setting:price-control:guide-apply:void'
const stopPermission = 'setting:price-control:guide-apply:stop'
const deletePermission = 'setting:price-control:guide-apply:delete'

const standardFields: AiField[] = [
  field('list[].id', 'string | number', '价格管控标准ID；停用、删除审批校验、删除和关联申请查看都使用它。'),
  field('list[].orgId', 'string | null', '管控组织ID；只读原值，不能用officeName代替。', { nullable: true }),
  field('list[].officeName', 'string | null', '管控组织名称；只读展示。', { nullable: true }),
  field('list[].controlPeriod', 'string | null', '管控周期，Portal表格使用YYYY-MM-DD~YYYY-MM-DD；停用时必须拆成controlStartDate/controlEndDate。', { nullable: true, format: 'YYYY-MM-DD~YYYY-MM-DD' }),
  field('list[].categoryId', 'integer | null', '价格管控品类ID；列表筛选使用商品品类ID。', { nullable: true }),
  field('list[].catName', 'string | null', '品类展示名称；只读。', { nullable: true }),
  field('list[].itemId', 'integer | null', '商品ID；只读。', { nullable: true }),
  field('list[].itemName', 'string | null', '商品名称；只读。', { nullable: true }),
  field('list[].skuId', 'integer | null', '商品规格ID；只读。', { nullable: true }),
  field('list[].specInfo', 'string | null', '规格展示文本；只读。', { nullable: true }),
  field('list[].controlType', 'string | null', '管控类型展示名称；标准停用请求由Portal固定发送controlType=1。', { nullable: true }),
  field('list[].guidePrice', 'string | null', '指导价展示字符串；Portal可能返回两位小数或“-”，不要当作创建表单的number直接回传。', { nullable: true }),
  field('list[].updateTime', 'string | null', '标准最后更新时间原值；只读。', { nullable: true }),
  field('list[].status', 'integer | null', '标准启停状态；停用前必须为1。', { nullable: true }),
  field('list[].applyId', 'string | number | null', '关联指导价申请ID；查看动作没有它时Portal直接提示暂无关联申请。', { nullable: true }),
  field('list[].statusName', 'string | null', '标准状态展示名称；不能替代status/statusValue判断动作条件。', { nullable: true }),
  field('list[].statusValue', 'integer | null', 'Portal派生状态：1待生效、2生效中、3已过期；只有2显示停用。', { nullable: true, values: { '1': '待生效', '2': '生效中', '3': '已过期' } }),
  field('list[].processInstanceId', 'string | null', '可选流程实例ID；有值时查看交给通用流程详情，没有时使用005详情表单。', { optional: true, nullable: true }),
]

const applicationFields: AiField[] = [
  field('list[].id', 'string | number', '指导价申请ID；查看、撤回、重新发起和作废都使用它。'),
  field('list[].orgId', 'string | null', '管控组织ID；列表筛选的orgIds使用组织树选中的ID数组。', { nullable: true }),
  field('list[].orgFullName', 'string | null', '管控组织完整名称；只读展示。', { nullable: true }),
  field('list[].controlPeriod', 'string | null', '管控周期展示文本。', { nullable: true }),
  field('list[].categoryId', 'integer | null', '后端列表过滤/展示的品类ID。', { nullable: true }),
  field('list[].categoryFullName', 'string | null', '管控品类完整名称；只读展示。', { nullable: true }),
  field('list[].createTime', 'string | null', '申请创建时间原值。', { nullable: true }),
  field('list[].approveTime', 'string | null', '审批时间原值；审批中可能为空。', { nullable: true }),
  field('list[].status', 'integer | null', '流程状态：1审批中、2审批通过、3审批驳回、4已取消、5已废除。', { nullable: true, values: { '1': '审批中', '2': '审批通过', '3': '审批驳回', '4': '已取消', '5': '已废除' } }),
  field('list[].statusName', 'string | null', '状态展示名称；动作条件以status数值为准。', { nullable: true }),
  field('list[].processInstanceId', 'string | null', '流程实例ID；有值时查看交给通用流程详情。', { nullable: true }),
]

const categoryFields: AiField[] = [
  field('[]', 'object', '指导价申请管控品类树根节点。'),
  field('[].catId', 'integer', '品类ID；二级节点可作为applicationForm.categoryId。'),
  field('[].parentId', 'integer | null', '父品类ID；只用于树结构。', { nullable: true }),
  field('[].catName', 'string', '品类名称；展示用，不能代替catId。'),
  field('[].level', 'string', '后端层级原值；Portal仅允许Number(level)===2的节点选择。'),
  field('[].isLeaf', 'integer | null', '后端叶子标记原值。', { nullable: true }),
  field('[].disabled', 'boolean', 'SDK按Portal mapTree规则派生；level不是2时为true。'),
  field('[].children', 'object[]', '子品类节点，结构同当前节点。'),
]

const itemFields: AiField[] = [
  field('list[].itemId', 'integer', '商品ID；用于applicationSkuList。'),
  field('list[].itemName', 'string', '商品名称；回填表单展示。'),
  field('list[].unit', 'string | null', '商品默认单位；提交明细unit的候选。', { nullable: true }),
  field('list[].unit2', 'string | null', '商品第二单位原值。', { nullable: true }),
  field('list[].graySign', 'string | null', '商品灰度标记原值；不参与提交。', { nullable: true }),
]

const skuFields: AiField[] = [
  field('list[].skuId', 'integer', '规格ID；填入申请明细skuId。'),
  field('list[].specInfo', 'string', '规格描述；只用于选择与展示。'),
]

const detailFields: AiField[] = [
  field('id', 'string | number', '指导价申请ID。'),
  field('orgId', 'string | null', '管控组织ID；创建请求必须保留为字符串。', { nullable: true }),
  field('orgFullName', 'string | null', '管控组织名称。', { nullable: true }),
  field('controlStartDate', 'string | null', '管控开始日期；YYYY-MM-DD。', { nullable: true, format: 'YYYY-MM-DD' }),
  field('controlEndDate', 'string | null', '管控结束日期；YYYY-MM-DD，创建时必须晚于当天。', { nullable: true, format: 'YYYY-MM-DD' }),
  field('controlPeriod', 'string | null', '管控周期展示文本。', { nullable: true }),
  field('categoryId', 'integer | null', '管控品类ID。', { nullable: true }),
  field('parentCategoryId', 'integer | null', '一级品类ID；后端补出，不能代替提交categoryId。', { nullable: true }),
  field('parentCategoryName', 'string | null', '一级品类名称。', { nullable: true }),
  field('categoryName', 'string | null', '当前品类名称。', { nullable: true }),
  field('categoryFullName', 'string | null', '完整品类名称。', { nullable: true }),
  field('controlType', 'integer | null', '管控类型：1按指导价、2按当地市场报价。', { nullable: true, values: { '1': '按指导价', '2': '按当地市场报价' } }),
  field('approvalTag', 'string | null', '审批标识字典值；用于流程分支。', { nullable: true }),
  field('applicantId', 'string | number | null', '申请人ID；后端创建时以当前会话用户为准。', { nullable: true }),
  field('applicantName', 'string | null', '申请人名称。', { nullable: true }),
  field('reason', 'string | null', '申请原因；Portal输入上限500字符，后端同样声明500。', { nullable: true }),
  field('attachments', 'object[]', 'OSS附件数组；每项至少包含name和url，文件数量最多50。'),
  field('processInstanceId', 'string | null', '流程实例ID；查看时有值应优先走通用流程详情。', { nullable: true }),
  field('status', 'integer | null', '申请流程状态。', { nullable: true }),
  field('statusName', 'string | null', '申请状态名称。', { nullable: true }),
  field('createTime', 'string | null', '创建时间。', { nullable: true }),
  field('approveTime', 'string | null', '审批时间。', { nullable: true }),
  field('voidTime', 'string | null', '作废时间。', { nullable: true }),
  field('items', 'object[]', '申请商品明细；回显字段多于创建请求字段。'),
  field('items[].id', 'string | number | null', '回显明细ID；创建请求必须剔除。', { optional: true, nullable: true }),
  field('items[].itemId', 'integer', '商品ID。'),
  field('items[].skuId', 'integer', '规格ID。'),
  field('items[].guidePrice', 'number', '指导价格；单位元，最多2位小数。'),
  field('items[].unit', 'string | null', '商品单位。', { nullable: true }),
  field('items[].itemName', 'string | null', '商品名称回显字段；创建请求不发送。', { optional: true, nullable: true }),
  field('items[].specInfo', 'string | null', '规格回显字段；创建请求不发送。', { optional: true, nullable: true }),
]

const requestFields: AiField[] = [
  field('draft', 'object', 'prepareCreate返回的指导价申请请求草稿。'),
  field('draft.orgId', 'string', '管控组织ID；由Portal表单值转成字符串。'),
  field('draft.controlStartDate', 'string', '管控开始日期，YYYY-MM-DD。'),
  field('draft.controlEndDate', 'string', '管控结束日期，YYYY-MM-DD，必须晚于当天。'),
  field('draft.categoryId', 'integer', '可选二级管控品类ID。'),
  field('draft.controlType', 'integer', '管控类型1或2。'),
  field('draft.approvalTag', 'string', '审批标识字典值。'),
  field('draft.reason', 'string | null', '申请原因；空字符串转换为null，最多500字符。', { nullable: true }),
  field('draft.attachments', 'object[]', 'Portal当前表单附件原样数组；最多50项。'),
  field('draft.items', 'object[]', '实际create请求的商品明细；不含回显id、itemName、specInfo。'),
  field('draft.items[].itemId', 'integer', '商品ID。'),
  field('draft.items[].skuId', 'integer', '规格ID。'),
  field('draft.items[].guidePrice', 'number', '指导价，非负且最多2位小数。'),
  field('draft.items[].unit', 'string | null', '商品单位；空字符串转换为null。', { nullable: true }),
]

const pageOutput = (rows: AiField[], name: string): AiContract['output'] => ({
  shape: '{ list: object[], total: number }',
  fields: [field('$', 'object', `${name}分页结果。`), field('list', 'object[]', '当前页数据，不是全量结果。'), field('total', 'number', '符合筛选条件的总数，用于翻页。'), ...rows],
  empty: 'list=[]表示当前页无记录；total=0才表示没有匹配记录，权限、租户或网络错误会抛错。',
})

const trueOutput: AiContract['output'] = {
  shape: 'boolean',
  fields: [field('$', 'boolean', '后端业务成功回执；SDK只接受true，不把它当作写入终态证据。', { values: { true: '后端接受请求' } })],
  empty: '返回false、缺失或其它值时抛错；true仍必须按契约回查。',
}
const actionOutput: AiContract['output'] = {
  shape: '{ id: string | number, status: integer }',
  fields: [field('id', 'string | number', '已确认目标的指导价申请ID。'), field('status', 'integer', '准备动作时读取到的按钮状态。')],
  empty: 'ID非法或状态不满足Portal按钮条件时抛错，不发送动作请求。',
}
const standardActionOutput: AiContract['output'] = {
  shape: '{ record: object }',
  fields: standardFields.map(item => ({ ...item, path: item.path.replace(/^list\[\]/, 'record') })),
  empty: '记录不完整、不是生效中标准或周期格式不合法时抛错。',
}
const removeOutput: AiContract['output'] = {
  shape: '{ id: string | number }',
  fields: [field('id', 'string | number', '通过审批状态校验、待用户确认删除的标准ID。')],
  empty: '审批状态有提示或ID非法时准备阶段抛错且不发送DELETE。',
}
const cancelOutput: AiContract['output'] = { shape: '{ cancelled: true }', fields: [field('cancelled', 'boolean', '固定为true，表示本地标准表单草稿已放弃')], empty: '不发HTTP请求，不改变服务端标准。' }
const approvalOutput: AiContract['output'] = {
  shape: 'string | null',
  fields: [field('$', 'string | null', '删除前审批状态提示；null/空字符串表示Portal允许继续弹出删除确认。', { nullable: true })],
  empty: 'null表示没有阻断提示，不等于标准已经删除。',
}

const formInput = param('005指导价申请PC表单。', '用户输入、sale-price-control-application-category-tree、application-item-list和application-sku-list返回的当前可选数据', {
  type: 'object',
  required: true,
  constraints: [
    'orgId、controlDate、controlType、categoryId、approvalTag必填；categoryId必须是树中level=2且disabled=false的节点。',
    'controlDate结束日期不能早于开始日期，且结束日期必须严格晚于当天；goodsList至少一行，每行itemId、skuId、guidePrice必填。',
    'guidePrice必须为非负数字且最多2位小数；reason可空但最多500字符；attachments最多50项且每项至少有name/url。',
  ],
})
const draftInput = param('prepareCreate返回的请求草稿。', 'sale-price-control-prepare-create.result.draft', { type: 'object', required: true, constraints: ['确认后原样交给create；不要把详情items的id、itemName、specInfo补回请求。'] })
const idInput = (meaning: string, source: string) => param(meaning, source, { type: 'string | number', required: true })
const statusInput = param('当前列表行的流程状态，用于复核Portal按钮是否可见。', 'sale-price-control-application-list.list[].status或用户确认的当前记录', { type: 'integer', required: true, constraints: ['撤回仅允许1审批中；作废仅允许2审批通过。'] })
const recordInput = param('当前价格管控标准列表中的完整原始记录。', 'sale-price-control-standard-list.list[]，停用前重新确认目标行', { type: 'object', required: true, constraints: ['必须保留Portal停用时展开的原字段和controlPeriod；只有status=1且statusValue=2可停用。'] })
const gaps = ['尚未在真实测试环境执行本页列表、分类树、005表单提交、撤回/作废/停用/删除、第三方开关及写入后的独立回查；当前证据来自Portal源码、销售Java源码和离线请求断言。']

function base (purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      `只覆盖“系统设置→销售设置→价格管控”页面${pagePath}、可达的005指导价申请表单${formPath}和当前页面动作；不覆盖下一页“低价设置”，也不覆盖独立生产根菜单。`,
      `页面入口受${pagePermission}控制；指导价申请、查看、撤回、重新发起、作废、停用、删除分别受${applyPermission}、${viewPermission}、${withdrawPermission}、${resubmitPermission}、${voidPermission}、${stopPermission}、${deletePermission}控制。第三方收款开关源码未做按钮权限判断，仍以服务端授权和响应为准。`,
      '所有请求绑定Portal platform实例并使用销售页面module-type=60；源码中的有无前导斜杠路径保持不变，因为Portal请求封装对相对路径有不同处理。',
      '标准列表的停用/删除是当前可达动作；隐藏的旧标准配置表单和下一页低价设置的priceControlStandardConfig接口不在本节点。',
      '提交申请会启动guide_price_apply审批流程；返回申请ID不等于审批通过，撤回/作废只能在页面对应状态下执行。',
    ],
    effect,
    prerequisites: ['SDK已绑定当前用户、租户、会话token和platform base URL；ID、组织、品类、商品和规格均来自当前用户可见数据或用户明确输入。'],
    inputs: {},
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? 'Promise完成只表示响应通过校验；成功或超时后必须按同一ID、筛选条件或开关重新读取核对。' : effect === 'prepare' ? '得到无副作用的确认草稿，尚未发送写请求；取消只丢弃草稿。' : '返回通过结构校验的当前页面数据。',
    failures: ['非法分页、ID、状态、日期、表单、价格、附件或响应形状在请求前/响应后失败；权限、租户、网络、流程和后端业务错误原样抛出。', 'SDK不把审批状态名称、成功提示或true回执当作写入后的独立证据。'],
    idempotency: effect === 'write' ? '后端没有requestId；create超时先用申请列表/详情按业务字段回查，标准停用/删除和开关更新也先回查再决定是否重试。' : null,
    evidence: [
      { source: 'CodeReview_Projects_Js@test/portal/main: app/portal/menus/sale.js:191-194、app/portal/views/dashboard/sale/setting/price-control/list.vue、simple/sales/form/005/page/pc/edit/index.vue、simple/sales/form/005/page/pc/detail/index.vue', kind: 'reference', note: '证明页面归属、Tab筛选、按钮权限、原始URL/方法/参数、005表单校验和提交字段剔除规则。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-sales/.../PriceControlApplyController.java、PriceControlApplySaveReqVO.java、PriceControlApplyItemVO.java、PriceControlApplyServiceImpl.java、PriceControlStandardsController.java、ThirdPartyPaymentController.java', kind: 'reference', note: '证明申请创建/撤回/作废、字段校验、流程key、标准动作和第三方开关回执。' },
      { source: 'src/capabilities/sale-price-control.ts 与 test/sale-price-control.test.ts', kind: 'test', note: '锁定Portal原始请求、表单提交字段、状态条件、platform/module-type和坏回执；不替代真实环境验证。' },
      { source: 'docs/pages/价格管控.md', kind: 'reference', note: '记录本页能力定义、参数、逐字段基准、操作步骤和真实环境缺口。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'sale-price-control-category-list': {
    ...base('查询价格管控标准页的商品品类选项。', { shape: 'object[]', fields: [field('[]', 'object', '商品品类选项。'), field('[].catId', 'integer', '品类ID；填入standard-list.categoryId。'), field('[].catName', 'string', '品类名称；展示用。')], empty: '没有品类时返回[]。' }, ['把catId作为standardList.categoryId；不要把名称当成ID。']),
  },
  'sale-price-control-standard-list': {
    ...base('查询价格管控标准Tab的分页列表。', pageOutput(standardFields, '价格管控标准'), ['保留list[].id、applyId、processInstanceId和statusValue；查看、停用、删除前都用当前列表记录，不凭statusName猜状态。']),
    inputs: {
      pageNo: param('从1开始的页码。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认1' }),
      pageSize: param('每页条数。', '调用方分页状态；Portal默认20', { type: 'integer', required: false, default: 'SDK默认20', constraints: ['接受10/20/50/100。'] }),
      categoryId: param('商品品类ID。', 'sale-price-control-category-list.result[].catId或用户明确选择', { type: 'integer | null', required: false, nullable: true }),
      itemName: param('商品名称关键字。', '用户输入', { type: 'string | null', required: false, nullable: true }),
      officeIds: param('销售组织节点ID数组；SDK按Portal转成逗号字符串officeId。', '用户从Portal销售组织树选择的节点', { type: '(string | number)[] | null', required: false, nullable: true }),
    },
  },
  'sale-price-control-application-list': {
    ...base('查询指导价申请Tab的分页列表。', pageOutput(applicationFields, '指导价申请'), ['按status数值决定撤回/作废/重新发起；有processInstanceId时查看走通用流程详情，否则用005详情表单。']),
    inputs: {
      pageNo: param('从1开始的页码。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认1' }),
      pageSize: param('每页条数。', '调用方分页状态；Portal默认20', { type: 'integer', required: false, default: 'SDK默认20', constraints: ['接受10/20/50/100。'] }),
      categoryId: param('管控品类ID。', 'sale-price-control-application-category-tree.result[].catId或用户明确选择', { type: 'integer | null', required: false, nullable: true }),
      officeIds: param('管控组织ID数组；SDK按Portal转成逗号字符串orgIds。', '用户从Portal销售组织树选择的节点', { type: '(string | number)[] | null', required: false, nullable: true }),
      controlPeriod: param('管控周期日期范围；SDK按Portal拆为controlPeriodStart/controlPeriodEnd。', '用户选择的日期范围', { type: '[string, string] | [] | null', required: false, nullable: true, format: 'YYYY-MM-DD' }),
      status: param('流程状态：1审批中、2审批通过、3审批驳回、4已取消、5已废除。', '平台字典bpm_process_instance_status_approval或用户明确选择', { type: 'integer | null', required: false, nullable: true, options: [{ value: 1, label: '审批中' }, { value: 2, label: '审批通过' }, { value: 3, label: '审批驳回' }, { value: 4, label: '已取消' }, { value: 5, label: '已废除' }] }),
    },
  },
  'sale-price-control-application-category-tree': {
    ...base('查询005指导价申请表单使用的管控品类树。', { shape: 'object[]', fields: categoryFields, empty: '没有可见品类时返回[]；只有level=2节点可选择。' }, ['选择disabled=false的二级节点catId填入prepareCreate.form.categoryId；父节点和其它层级仅用于展示。']),
  },
  'sale-price-control-application-item-list': {
    ...base('按可选二级品类查询指导价申请商品候选。', { shape: 'object[]', fields: itemFields, empty: '该品类没有商品时返回[]；不要手写商品ID。' }, ['选择list[].itemId后调用applicationSkuList；把unit作为申请明细单位候选。']),
    inputs: { categoryId: param('可选二级品类ID。', 'sale-price-control-application-category-tree.result[].catId', { type: 'integer', required: true }) },
  },
  'sale-price-control-application-sku-list': {
    ...base('按商品查询指导价申请规格候选。', { shape: 'object[]', fields: skuFields, empty: '该商品没有规格时返回[]。' }, ['选择list[].skuId填入prepareCreate.form.goodsList[].skuId，并保留当前商品与规格配对。']),
    inputs: { itemId: param('商品ID。', 'sale-price-control-application-item-list.result.list[].itemId', { type: 'integer', required: true }) },
  },
  'sale-price-control-application-get': {
    ...base('读取一条指导价申请详情。', { shape: 'object', fields: detailFields, empty: '申请不存在或详情响应字段不合法时抛错，不伪造空申请。' }, ['详情用于展示、重新发起表单回显和写入后的逐字段回查；回显items的id/itemName/specInfo不能带入create请求。']),
    inputs: { id: idInput('当前列表明确选定的指导价申请ID。', 'sale-price-control-application-list.list[].id') },
  },
  'sale-price-control-prepare-create': {
    ...base('按005指导价申请PC表单和后端请求VO准备提交草稿，不发送create。', { shape: '{ draft: object }', fields: requestFields, empty: '表单字段、日期、商品明细、价格、原因或附件不符合Portal规则时抛错且不发送请求。' }, ['先从category-tree、item-list、sku-list取得当前候选；向用户展示draft并取得明确确认。', '确认后把同一draft交给create；取消只丢弃draft。'], 'prepare'),
    inputs: { form: formInput },
    steps: [
      { role: 'required', when: '需要选择管控品类', capabilityId: 'sale-price-control-application-category-tree', mapping: {}, instruction: '只从disabled=false的二级节点选择categoryId。' },
      { role: 'required', when: '需要选择商品和规格', capabilityId: 'sale-price-control-application-item-list', mapping: { categoryId: 'user.form.categoryId' }, instruction: '按当前品类读取商品，再按每个itemId读取规格；不要跨品类拼接。' },
      { role: 'required', when: '用户明确确认提交', capabilityId: 'sale-price-control-create', mapping: { draft: 'result.draft' }, instruction: '提交同一份请求草稿；请求会启动guide_price_apply审批流程，不代表审批通过。' },
      { role: 'cancel', when: '用户取消提交申请', instruction: '只丢弃draft，不调用create。' },
    ],
  },
  'sale-price-control-create': {
    ...base('提交一条用户确认的指导价申请并启动审批流程。', { shape: 'string | number', fields: [field('$', 'string | number', '后端返回的申请业务ID；用于详情和列表回查。')], empty: '返回ID非法或请求失败时抛错；不把返回ID当成审批通过。' }, ['返回申请ID后调用applicationGet逐字段回查；需要看流程进度时把processInstanceId交给通用流程详情能力。'], 'write'),
    inputs: { draft: draftInput },
    steps: [{ role: 'recovery', when: 'create返回ID、超时或响应丢失后核实结果', capabilityId: 'sale-price-control-application-get', mapping: { id: 'result.$' }, instruction: '读取同一申请ID，核对组织、周期、品类、审批标识、商品明细和附件；无法定位时不要盲目重复提交。' }],
  },
  'sale-price-control-prepare-standard-create': {
    ...base('按价格管控标准隐藏表单规则准备创建草稿，不发送POST。', { shape: '{ draft: object }', fields: [field('draft', 'object', '标准创建请求草稿'), field('draft.id', 'null', '创建时固定为null', { nullable: true }), field('draft.orgId', 'string | number', '管控组织ID'), field('draft.controlStartDate', 'string', '管控开始日期，YYYY-MM-DD'), field('draft.controlEndDate', 'string', '管控结束日期，YYYY-MM-DD'), field('draft.categoryId', 'integer', '品类ID'), field('draft.itemId', 'integer', '商品ID'), field('draft.skuId', 'integer', '规格ID'), field('draft.controlType', '1', 'Portal固定管控类型1'), field('draft.guidePrice', 'number', '指导价，单位元且最多2位小数'), field('draft.status', '1', '创建时固定启用状态1')], empty: '日期范围、组织、品类、商品、规格、管控类型或价格不符合Portal/Java约束时抛错；不发送请求。' }, ['向用户展示controlStartDate/controlEndDate和最终请求字段；确认后把同一draft交给standard-create，取消调用cancel-standard-create。'], 'prepare'),
    inputs: { form: param('价格管控标准创建隐藏表单。', 'Portal价格管控标准新增弹窗/隐藏表单', { type: 'object', required: true, constraints: ['必填orgId、controlDate或controlStartDate/controlEndDate、categoryId、itemId、skuId、controlType=1、guidePrice；controlDate会拆成两个日期字段。'] }) },
    steps: [{ role: 'required', when: '用户明确确认创建标准', capabilityId: 'sale-price-control-standard-create', mapping: { draft: 'result.draft' }, instruction: '原样提交prepare返回的draft，不把列表展示字段或controlPeriod补回请求。' }, { role: 'cancel', when: '用户取消创建标准', capabilityId: 'sale-price-control-cancel-standard-create', mapping: {}, instruction: '只丢弃本地draft，不发送POST。' }],
  },
  'sale-price-control-standard-create': {
    ...base('创建一条价格管控标准并返回新标准ID。', { shape: 'string | number', fields: [field('$', 'string | number', '后端创建返回的标准ID；用于列表回查和后续动作。')], empty: '返回ID非法、权限或业务校验失败时抛错；不把POST成功提示当作列表已生效。' }, ['请求使用POST /admin-api/sales/price-control-standards/create；返回ID后刷新standard-list并逐字段核对组织、周期、品类、商品、规格、价格和状态。'], 'write'),
    inputs: { draft: param('prepare-standard-create返回的完整标准创建草稿。', 'sale-price-control-prepare-standard-create.result.draft', { type: 'object', required: true, constraints: ['必须原样传递；不要用controlPeriod替代controlStartDate/controlEndDate。'] }) },
    steps: [{ role: 'recovery', when: '创建成功、超时或响应丢失后核实', capabilityId: 'sale-price-control-standard-list', mapping: {}, instruction: '按保存的组织、日期、品类、商品和规格跨页查找新ID；没有唯一匹配时报告结果不确定，不盲目重建。' }],
  },
  'sale-price-control-cancel-standard-create': {
    ...base('取消价格管控标准创建的本地草稿，不发送POST。', cancelOutput, ['只表示提交前草稿已放弃；不能撤销已返回新ID的标准创建。'], 'local'),
    inputs: {},
    steps: [],
    completion: '返回cancelled=true且没有网络副作用。',
    idempotency: null,
  },
  'sale-price-control-prepare-standard-update': {
    ...base('按价格管控标准编辑隐藏表单规则准备完整更新草稿，不发送PUT。', { shape: '{ draft: object }', fields: [field('draft', 'object', '标准编辑请求草稿'), field('draft.id', 'string | number', '当前标准ID'), field('draft.orgId', 'string | number', '管控组织ID'), field('draft.controlStartDate', 'string', '管控开始日期，YYYY-MM-DD'), field('draft.controlEndDate', 'string', '管控结束日期，YYYY-MM-DD'), field('draft.categoryId', 'integer', '品类ID'), field('draft.itemId', 'integer', '商品ID'), field('draft.skuId', 'integer', '规格ID'), field('draft.controlType', '1', 'Portal固定管控类型1'), field('draft.guidePrice', 'number', '指导价，单位元且最多2位小数'), field('draft.status', 'integer | null', '编辑表单保留的状态字段', { nullable: true })], empty: '缺少当前标准ID、日期、组织、品类、商品、规格或价格时抛错；不发送请求。' }, ['先读取当前标准列表行并保留id；向用户展示最终draft，确认后交给standard-update，取消调用cancel-standard-update。'], 'prepare'),
    inputs: { form: param('价格管控标准编辑隐藏表单。', 'Portal价格管控标准编辑表单及当前列表行', { type: 'object', required: true, constraints: ['必须带当前id；controlDate会拆分日期；controlType必须为1；展示字段不能替代ID。'] }) },
    steps: [{ role: 'required', when: '用户明确确认编辑标准', capabilityId: 'sale-price-control-standard-update', mapping: { draft: 'result.draft' }, instruction: '原样提交prepare返回的draft；不要加入controlPeriod或展示名称字段。' }, { role: 'cancel', when: '用户取消编辑标准', capabilityId: 'sale-price-control-cancel-standard-update', mapping: {}, instruction: '只丢弃本地draft，不发送PUT。' }],
  },
  'sale-price-control-standard-update': {
    ...base('保存一条价格管控标准的完整编辑表单。', trueOutput, ['请求使用PUT /admin-api/sales/price-control-standards/update；返回true后按同一ID刷新standard-list逐字段回查。'], 'write'),
    inputs: { draft: param('prepare-standard-update返回的完整标准编辑草稿。', 'sale-price-control-prepare-standard-update.result.draft', { type: 'object', required: true, constraints: ['必须含当前标准id；只能提交同一份prepare结果。'] }) },
    steps: [{ role: 'recovery', when: '更新成功、超时或响应丢失后核实', capabilityId: 'sale-price-control-standard-list', mapping: {}, instruction: '按同一标准ID核对组织、日期、品类、商品、规格、价格和状态；不能只看true回执。' }],
  },
  'sale-price-control-cancel-standard-update': {
    ...base('取消价格管控标准编辑的本地草稿，不发送PUT。', cancelOutput, ['只表示提交前草稿已放弃；不能恢复已经提交的远端编辑。'], 'local'),
    inputs: {},
    steps: [],
    completion: '返回cancelled=true且没有网络副作用。',
    idempotency: null,
  },
  'sale-price-control-prepare-withdraw': {
    ...base('准备撤回一条审批中的指导价申请，不发送DELETE。', actionOutput, ['仅当Portal撤回按钮可见且status=1时准备；展示目标申请后取得明确确认。'], 'prepare'),
    inputs: { id: idInput('当前列表选定的指导价申请ID。', 'sale-price-control-application-list.list[].id'), status: statusInput },
    steps: [{ role: 'required', when: '用户明确确认撤回', capabilityId: 'sale-price-control-withdraw', mapping: { id: 'result.id', status: 'result.status' }, instruction: '提交同一ID和已确认的status=1。' }, { role: 'cancel', when: '用户取消撤回', instruction: '只丢弃撤回草稿，不发送请求。' }],
  },
  'sale-price-control-withdraw': {
    ...base('撤回当前用户仍在审批中的指导价申请。', trueOutput, ['后端只允许申请人撤回status=1的申请；返回true后刷新applicationList确认状态变为已取消。'], 'write'),
    inputs: { id: idInput('指导价申请ID。', 'sale-price-control-prepare-withdraw.result.id'), status: statusInput },
    steps: [{ role: 'recovery', when: '撤回成功、超时或响应丢失后核实', capabilityId: 'sale-price-control-application-list', mapping: {}, instruction: '刷新列表按同一ID确认状态；超时先回查，不盲目重复撤回。' }],
  },
  'sale-price-control-prepare-void': {
    ...base('准备作废一条已审批通过的指导价申请，不发送PUT。', actionOutput, ['仅当Portal作废按钮可见且status=2时准备；先向用户说明作废后对应范围不再按该价格校验。'], 'prepare'),
    inputs: { id: idInput('当前列表选定的指导价申请ID。', 'sale-price-control-application-list.list[].id'), status: statusInput },
    steps: [{ role: 'required', when: '用户明确确认作废', capabilityId: 'sale-price-control-void', mapping: { id: 'result.id', status: 'result.status' }, instruction: '提交同一ID和已确认的status=2。' }, { role: 'cancel', when: '用户取消作废', instruction: '只丢弃作废草稿，不发送请求。' }],
  },
  'sale-price-control-void': {
    ...base('作废一条已审批通过的指导价申请。', trueOutput, ['Portal请求使用PUT、data=null和params.id；返回true后刷新列表确认status=5或对应状态展示。'], 'write'),
    inputs: { id: idInput('指导价申请ID。', 'sale-price-control-prepare-void.result.id'), status: statusInput },
    steps: [{ role: 'recovery', when: '作废成功、超时或响应丢失后核实', capabilityId: 'sale-price-control-application-list', mapping: {}, instruction: '刷新列表按同一ID确认状态；超时先回查，不盲目重复作废。' }],
  },
  'sale-price-control-prepare-stop': {
    ...base('准备停用一条生效中的价格管控标准，不发送PUT。', standardActionOutput, ['仅当Portal停用按钮可见，即record.status=1且record.statusValue=2并且有stop权限时准备；保留原记录字段供请求展开。'], 'prepare'),
    inputs: { record: recordInput },
    steps: [{ role: 'required', when: '用户明确确认停用', capabilityId: 'sale-price-control-stop', mapping: { record: 'result.record' }, instruction: '提交同一完整record；Portal会固定把controlType改成1、status改成0并拆分周期。' }, { role: 'cancel', when: '用户取消停用', instruction: '只丢弃record草稿，不发送请求。' }],
  },
  'sale-price-control-stop': {
    ...base('停用一条生效中的价格管控标准。', trueOutput, ['请求体保留Portal展开的原记录字段，并追加controlType=1、status=0、controlStartDate和controlEndDate；返回true后刷新标准列表核对同一ID。'], 'write'),
    inputs: { record: recordInput },
    steps: [{ role: 'recovery', when: '停用成功、超时或响应丢失后核实', capabilityId: 'sale-price-control-standard-list', mapping: {}, instruction: '按同一标准ID刷新列表确认状态变化；超时先回查，不盲目重发。' }],
  },
  'sale-price-control-standard-approval-status': {
    ...base('查询价格管控标准删除前的审批阻断提示。', approvalOutput, ['返回null或空字符串才允许进入Portal删除确认；返回提示文本时停止删除并原样告知用户。']),
    inputs: { id: idInput('当前列表选定的价格管控标准ID。', 'sale-price-control-standard-list.list[].id') },
  },
  'sale-price-control-prepare-remove': {
    ...base('检查审批状态并准备删除价格管控标准，不发送DELETE。', removeOutput, ['先调用standardApprovalStatus；无阻断提示时向用户展示目标记录并取得明确确认，取消只丢弃id。'], 'prepare'),
    inputs: { id: idInput('当前列表选定的价格管控标准ID。', 'sale-price-control-standard-list.list[].id') },
    steps: [{ role: 'required', when: '用户明确确认删除', capabilityId: 'sale-price-control-remove', mapping: { id: 'result.id' }, instruction: '提交同一标准ID；后端权限和并发状态仍可能拒绝。' }, { role: 'cancel', when: '用户取消删除', instruction: '只丢弃删除草稿，不发送DELETE。' }],
  },
  'sale-price-control-remove': {
    ...base('删除一条通过审批状态预检查的价格管控标准。', trueOutput, ['返回true后刷新标准列表确认目标ID消失；删除前审批提示、权限或状态失败时保留原记录。'], 'write'),
    inputs: { id: idInput('价格管控标准ID。', 'sale-price-control-prepare-remove.result.id') },
    steps: [{ role: 'recovery', when: '删除成功、超时或响应丢失后核实', capabilityId: 'sale-price-control-standard-list', mapping: {}, instruction: '刷新列表确认同一ID不再出现；超时先回查，不盲目重删。' }],
  },
  'sale-price-control-get-third-party-setting': {
    ...base('读取价格管控页的第三方收款管控开关。', { shape: 'boolean', fields: [field('$', 'boolean', '第三方收款管控当前是否开启。')], empty: '响应不是boolean时抛错；请求失败不伪造为关闭。' }, ['true表示开关已开启，false表示已关闭；读取失败应向调用方暴露错误。']),
  },
  'sale-price-control-set-third-party-setting': {
    ...base('更新价格管控页的第三方收款管控开关。', trueOutput, ['Portal只发送{enabled}；返回true后调用getThirdPartySetting回查，不能只看成功提示。'], 'write'),
    inputs: { enabled: param('是否开启第三方收款管控。', '用户明确确认的开关值；Portal开关没有前端buttonPermissionFlag', { type: 'boolean', required: true }) },
    steps: [{ role: 'recovery', when: '开关更新成功、超时或响应丢失后核实', capabilityId: 'sale-price-control-get-third-party-setting', mapping: {}, instruction: '重新读取并确认开关终态；不确定时不要盲目反复切换。' }],
  },
}

export const SALE_PRICE_CONTROL_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALE_PRICE_CONTROL_METHODS).map(id => [id, contracts[id]!]))
export const SALE_PRICE_CONTROL_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALE_PRICE_CONTROL_METHODS).map(([id, method]) => [`salePriceControl.${method}`, SALE_PRICE_CONTROL_AI_CONTRACTS[id]!]))
