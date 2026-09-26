import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_OPENING_SUPPLIER_METHODS } from '../capabilities/finance-setting-opening-supplier.js'

const PAGE_PATH = '/dashboard/finance/setting/opening-supplier/list'
const PAGE_PERMISSION = '/dashboard/finance/setting/opening-supplier'
const idRules = ['安全正整数或无前导零的正整数字符串', '长ID保留字符串，不能用名称、行号或租户ID代替']

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: false,
  nullable: false,
  ...extra,
})
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })

const statusOptions = [{ value: 0, label: '启用' }, { value: 1, label: '停用' }]
const statusInput = optional('客商状态：0启用、1停用。列表默认只查启用记录。', 'Portal状态筛选器或列表行的status', '列表省略时发送0；启停必须明确传0或1。', { type: 'integer', options: statusOptions, constraints: ['只能是数值0或1，不能传布尔值。'] })
const bankInput = optional('收款银行账户数组；每个非空行必须有bankId，bankAccount只允许数字且最多50位。', 'Portal表单银行账户动态行', '发送空数组；空行会被Portal丢弃。', { type: 'object[]', constraints: ['bankId必须来自页面银行候选', 'bankAccount最多50位数字'] })
const fileInputs: Record<string, AiParameter> = {
  fileName: input('待导入Excel文件名。', '用户选择的文件名', { type: 'string', constraints: ['扩展名必须是.xlsx或.xls'] }),
  base64: input('待导入文件二进制内容的标准Base64。', '调用方读取的文件内容', { type: 'string', constraints: ['非空', '解码后不超过20MB'] }),
  contentType: optional('文件MIME类型。', '用户文件或调用方提供的MIME', '按fileName扩展名推导', { type: 'string', nullable: true }),
}

const rowFields = (prefix: string): AiField[] => [
  field(`${prefix}.id`, 'string | number', '客商基础档案主键；详情、编辑、启停和删除使用', { constraints: idRules }),
  field(`${prefix}.partyType`, 'string', '客商类型历史字段；页面不直接编辑', { nullable: true, nullMeaning: '后端未返回客商类型' }),
  field(`${prefix}.companyId`, 'string | number', '所属法人公司ID；不能用companyName代替', { nullable: true, constraints: idRules, nullMeaning: '后端未返回所属公司' }),
  field(`${prefix}.companyName`, 'string', '所属法人公司名称展示值', { nullable: true, nullMeaning: '后端未返回所属公司名称' }),
  field(`${prefix}.code`, 'string', '客商编码；创建时可由Portal按公司生成，手工编码只允许字母和数字且最多500位', { nullable: true, nullMeaning: '后端未返回编码' }),
  field(`${prefix}.name`, 'string', '客商名称；创建/编辑必填，最多500位'),
  field(`${prefix}.status`, 'integer', '绝对状态：0启用、1停用', { values: { '0': '启用', '1': '停用' } }),
  field(`${prefix}.detail`, 'string', '客商明细/描述；页面当前列表不展示', { nullable: true, optional: true, nullMeaning: '没有明细' }),
  field(`${prefix}.categoryCode`, 'string', '分类科目编码；来自分类候选', { nullable: true, nullMeaning: '没有分类' }),
  field(`${prefix}.categoryId`, 'string | number', '分类科目ID；服务端响应字段，提交页面使用categoryCode', { nullable: true, constraints: idRules, nullMeaning: '没有分类ID' }),
  field(`${prefix}.categoryName`, 'string', '分类名称展示值', { nullable: true, nullMeaning: '没有分类名称' }),
  field(`${prefix}.originalCompanyUpdate`, 'boolean', '是否为原公司更新客商'),
  field(`${prefix}.originalPartyId`, 'string | number', '原客商ID；originalCompanyUpdate为true时使用', { nullable: true, constraints: idRules, nullMeaning: '不是原公司更新或没有关联原客商' }),
  field(`${prefix}.originalPartyName`, 'string', '原客商名称展示值', { nullable: true, nullMeaning: '没有原客商' }),
  field(`${prefix}.bankAccounts`, 'object[]', '收款银行账户数组；空数组表示没有银行账户'),
  field(`${prefix}.bankAccounts[]`, 'object', '一条收款银行账户'),
  field(`${prefix}.bankAccounts[].id`, 'string | number', '银行账户关系主键', { nullable: true, constraints: idRules, nullMeaning: '后端未返回关系ID' }),
  field(`${prefix}.bankAccounts[].bankId`, 'string | number', '银行字典ID', { nullable: true, constraints: idRules, nullMeaning: '后端未返回银行ID' }),
  field(`${prefix}.bankAccounts[].bankCode`, 'string', '银行编码', { nullable: true, nullMeaning: '后端未返回银行编码' }),
  field(`${prefix}.bankAccounts[].bankName`, 'string', '银行名称', { nullable: true, nullMeaning: '后端未返回银行名称' }),
  field(`${prefix}.bankAccounts[].bankBranchName`, 'string', '开户支行名称，最多500位', { nullable: true, nullMeaning: '没有开户支行' }),
  field(`${prefix}.bankAccounts[].bankAccount`, 'string', '银行账号，只允许数字且最多50位', { nullable: true, nullMeaning: '没有银行账号' }),
  field(`${prefix}.bankAccounts[].bankDescription`, 'string', '银行描述展示值', { nullable: true, nullMeaning: '没有银行描述' }),
  field(`${prefix}.referenced`, 'boolean', '是否被业务数据引用；删除前由服务端最终判断', { nullable: true, nullMeaning: '后端未返回引用标志' }),
  field(`${prefix}.remark`, 'string', '备注；页面当前表单不展示', { optional: true, nullable: true, nullMeaning: '没有备注' }),
  field(`${prefix}.supplyChainFinance`, 'boolean', '是否为供应链金融客商档案'),
  field(`${prefix}.createTime`, 'string', '创建时间原值', { nullable: true, nullMeaning: '后端未返回创建时间' }),
  field(`${prefix}.updateTime`, 'string', '更新时间原值', { nullable: true, nullMeaning: '后端未返回更新时间' }),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [field('$', 'object', '客商基础档案分页结果'), field('list', 'array', '当前筛选页；不是全部记录'), field('list[]', 'object', '一条客商列表行'), ...rowFields('list[]'), field('total', 'integer', '筛选结果总数；不是当前页长度', { constraints: ['非负整数'] })],
  empty: 'list=[]且total=0表示当前筛选没有记录；权限、网络或响应结构失败会抛错，不改写为空列表。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: [field('$', 'object', '客商基础档案详情'), ...rowFields('$')],
  empty: '详情必须包含合法id、name、status和页面消费字段；后端找不到记录或响应缺字段时抛错，不返回null冒充不存在。',
}

const categoryOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('$', 'array', '启用的客商分类候选数组'), field('[]', 'object', '一条分类候选'), field('[].id', 'string | number', '分类ID', { nullable: true, constraints: idRules, nullMeaning: '候选未提供ID' }), field('[].code', 'string', '分类科目编码', { nullable: true, nullMeaning: '候选未提供编码' }), field('[].name', 'string', '分类名称')],
  empty: '[]表示当前会话没有可见分类；请求或响应结构失败会抛错。',
}

const companyTreeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('$', 'array', '法人公司树根节点数组'), field('[]', 'object', '公司树节点'), field('[].id', 'string | number', '公司/组织节点ID', { constraints: idRules }), field('[].parentId', 'string | number', '父节点ID', { nullable: true, constraints: idRules, nullMeaning: '根节点' }), field('[].name', 'string', '节点名称'), field('[].fullName', 'string', '公司完整名称', { nullable: true, nullMeaning: '后端未返回完整名称' }), field('[].isCorporation', 'integer', '是否法人公司：1可作为客商所属公司，0不可选', { values: { '0': '非法人组织', '1': '法人公司' } }), field('[].children', 'array', '子节点'), field('[].children[]', 'object', '子公司/组织节点')],
  empty: '[]表示当前会话没有可见公司树；非法人节点不能直接作为companyId提交。',
}

const optionOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('$', 'array', '原客商候选数组'), field('[]', 'object', '一条原客商候选'), field('[].id', 'string | number', '客商ID', { constraints: idRules }), field('[].companyId', 'string | number', '所属公司ID', { nullable: true, constraints: idRules, nullMeaning: '后端未返回公司ID' }), field('[].companyName', 'string', '所属公司名称', { nullable: true, nullMeaning: '后端未返回公司名称' }), field('[].code', 'string', '客商编码', { nullable: true, nullMeaning: '后端未返回编码' }), field('[].name', 'string', '客商名称'), field('[].status', 'integer', '客商状态：0启用、1停用', { values: { '0': '启用', '1': '停用' } }), field('[].sourceType', 'string', '候选来源类型', { nullable: true, nullMeaning: '后端未返回来源类型' }), field('[].originalPartyId', 'string | number', '候选自身原客商ID', { nullable: true, constraints: idRules, nullMeaning: '没有原客商' }), field('[].bankAccounts', 'object[]', '候选银行账户数组')],
  empty: '[]表示当前关键字和公司范围没有可用原客商；不能把空数组当作请求失败。',
}

const draftFields: AiField[] = [
  field('$', 'object', '尚未提交的客商基础档案草稿'),
  field('draft', 'object', '提交给create/update的页面业务字段'),
  field('draft.id', 'string | number', '编辑时的客商ID；创建草稿省略', { optional: true, constraints: idRules }),
  field('draft.name', 'string', '客商名称；去首尾空白后不能为空，最多500位'),
  field('draft.code', 'string', '手工编码或编码占位；autoAssignCode=true时可为空'),
  field('draft.autoAssignCode', 'boolean', '是否允许服务端自动分配编码'),
  field('draft.companyId', 'string | number', '法人公司ID；必须来自companyTree中isCorporation=1节点', { constraints: idRules }),
  field('draft.categoryCode', 'string', '分类编码', { optional: true, nullable: true, nullMeaning: '没有分类' }),
  field('draft.originalCompanyUpdate', 'boolean', '是否为原公司更新客商'),
  field('draft.originalPartyId', 'string | number', '原客商ID；开启原公司更新时必填', { optional: true, nullable: true, constraints: idRules, nullMeaning: '未开启原公司更新' }),
  field('draft.supplyChainFinance', 'boolean', '是否为供应链金融档案'),
  field('draft.bankAccounts', 'object[]', '过滤空行后的银行账户提交数组'),
  field('draft.bankAccounts[].bankId', 'string | number', '银行字典ID', { constraints: idRules }),
  field('draft.bankAccounts[].bankBranchName', 'string', '开户支行名称，最多500位', { nullable: true, nullMeaning: '没有开户支行' }),
  field('draft.bankAccounts[].bankAccount', 'string', '银行账号，只允许数字且最多50位', { nullable: true, nullMeaning: '没有银行账号' }),
  field('draft.status', 'integer', '绝对状态：0启用、1停用', { values: { '0': '启用', '1': '停用' } }),
]

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'boolean', '后端成功回执；只接受true', { values: { true: '操作成功' } })],
  empty: '后端返回false或其它值时抛错，不能把HTTP成功当作业务成功。',
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName: string, contentType: string, byteLength: integer, base64: string }',
  fields: [field('$', 'object', '非空Excel文件对象'), field('fileName', 'string', '下载文件名'), field('contentType', 'string', '文件MIME类型'), field('byteLength', 'integer', '文件字节数；必须大于0'), field('base64', 'string', '文件二进制标准Base64；可解码保存到本地')],
  empty: '响应不是二进制或为空文件时抛错，不返回空文件。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main@acab69acc77b6d6c0da21310cdfd26b91a01641e：app/portal/menus/finance.js、app/portal/views/dashboard/finance/setting/opening-supplier/list.vue、components/business-partner-list.vue、[mode]/[id].vue、detail/[id].vue', kind: 'reference', note: '逐页核对菜单路径、页面权限、筛选默认值、按钮权限、表单必填/长度/编码/银行账户规则、请求体、导入限制和导出筛选。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test@0f1a55718ebc1987affb8bf245106e809dd51da4：FinancePartyController、FinancePartyPageReqVO、FinancePartySaveReqVO、FinancePartyRespVO、FinancePartyServiceImpl及Excel服务', kind: 'reference', note: '核对客商分页、候选、详情、创建/编辑/启停/删除、模板/导入/导出端点、Long ID、银行账户校验、公司范围和整批导入规则。' },
  { source: 'src/capabilities/finance-setting-opening-supplier.ts', kind: 'implementation', note: '证明SDK使用platform实例、moduleType=null、按页面请求映射、表单校验、Base64转multipart、二进制文件投影和严格响应校验。' },
  { source: 'test/finance-setting-opening-supplier.test.ts', kind: 'test', note: '离线锁定Portal/Java锚点、默认请求、权限端点、表单提交规则、导入边界、响应投影和反证；不替代真实页面网络或持久化证据。' },
]

const boundaries = [
  `能力只覆盖保留页面${PAGE_PATH}及其可达的客商列表、分类/公司候选、详情、原客商搜索、编码生成、创建/编辑、启停、删除、模板、整批导入和导出；该页面是保留“系统设置”的后代，不是独立财务系统范围。`,
  `页面菜单权限是${PAGE_PERMISSION}；按钮权限按Portal分别是finance:setting:business-partner:create/update/delete/import/export。列表查询没有显式按钮permissionCheck，SDK不把前端按钮显示替代后端授权结论。`,
  '列表默认status=0、pageNo=1、pageSize=20、name/code为空字符串、companyIds为空数组；导出只发送筛选条件，不发送分页和排序键。',
  '创建/编辑只提交页面业务字段；companyName、categoryName、originalPartyName等展示字段不能作为保存字段。originalCompanyUpdate=true时originalPartyId必填；银行动态行有任意内容时必须选择bankId，空行被过滤。',
  '导入支持xls/xlsx、最大20MB，Portal与Java均按整批校验：任一行失败则整批不落库；SDK只负责文件和端点协议，不能把返回条数当作独立持久化证据。',
]

const failures = [
  'ID、状态、名称、编码、公司、原客商关系、银行账户、文件扩展名/Base64/大小或分页参数非法时在发请求前失败；不能用名称、行号或布尔值代替ID/状态。',
  '列表、详情、候选、公司树、文件或写回执结构不符合契约时抛错；不能把空对象、空文件或非true回执改写成成功。',
  '401/403、会话/租户范围、公司归属、编码唯一性、分类/原客商关系、银行账户重复或引用限制等后端业务错误原样暴露；前端权限隐藏不是后端授权证明。',
  '写入超时先按同一ID或列表筛选回查；SDK没有服务端requestId，也没有Portal提供的删除后撤销、导入撤销或通用cancel接口，不能盲目重放或伪造回滚。',
]

const gaps = [
  '本轮按任务要求未启动浏览器，未取得该页独立脱敏网络baseline；请求键、权限和表单语义来自固定Portal/Java源码与离线测试，不称为浏览器实测。',
  '尚未在真实测试租户执行读冒烟，也未完成创建/编辑/启停/删除/导入的prepare→submit→cancel真实闭环；页面没有后端cancel接口，写入终态需要真实环境按同一ID或列表回查。',
  'Java FinancePartyController中的PreAuthorize当前为注释状态；Portal按钮权限已记录，但部署环境最终授权仍需在线验证。',
]

function contract (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract {
  return {
    whenToUse: `操作Portal“系统设置→财务设置→客商基础档案”页面${PAGE_PATH}；按页面返回的ID、候选和草稿顺序使用，不猜测独立财务系统的不可达接口。`,
    boundaries,
    prerequisites: [
      '已建立带有效会话token、tenantId和用户/租户绑定platform实例；module-type按该页面推导为null，不手工补头。',
      '写入前取得当前页面可见的最新详情或列表行；用户确认prepare产生的草稿后才submit，提交后按同一ID/列表回查。',
    ],
    failures,
    evidence,
    gaps,
    ...value,
  }
}

const listInputs: Record<string, AiParameter> = {
  name: optional('客商名称模糊筛选。', 'Portal名称输入框', '发送空字符串，不按名称筛选', { type: 'string', nullable: true }),
  code: optional('客商编码模糊筛选。', 'Portal编码输入框', '发送空字符串，不按编码筛选', { type: 'string', nullable: true }),
  categoryCode: optional('分类科目编码筛选。', 'Portal分类选择器', '省略，不按分类筛选', { type: 'string', nullable: true }),
  companyIds: optional('所属法人公司ID数组。', 'Portal公司树多选结果', '发送空数组；服务端与当前有权限公司求交', { type: 'array<string | number>', constraints: idRules }),
  status: statusInput,
  supplyChainFinance: optional('是否为供应链金融档案筛选。', 'Portal供应链金融筛选器', '省略，不按该标识筛选', { type: 'boolean', nullable: true }),
  pageNo: optional('从1开始的页码。', '调用方分页状态', '默认1', { type: 'integer', constraints: ['正整数'] }),
  pageSize: optional('当前页条数。', '调用方分页状态或Portal分页器', '默认20；页面支持10、20、50、100', { type: 'integer', constraints: ['只能是10、20、50或100'] }),
}
const exportInputs: Record<string, AiParameter> = { ...listInputs }
delete exportInputs.pageNo
delete exportInputs.pageSize
const createInputs: Record<string, AiParameter> = {
  name: input('客商名称。', 'Portal创建/编辑表单名称输入框', { type: 'string', constraints: ['去首尾空白后不能为空', '最多500个字符'] }),
  code: optional('客商编码。', 'Portal编码输入框或generateCode结果', 'autoAssignCode=true时可省略；否则必填', { type: 'string', constraints: ['只能包含字母和数字', '最多500个字符'] }),
  autoAssignCode: optional('是否自动分配客商编码。', 'Portal自动编码开关', 'false', { type: 'boolean' }),
  companyId: input('所属法人公司ID。', 'companyTree中isCorporation=1的节点ID', { type: 'string | number', constraints: idRules }),
  categoryCode: optional('分类科目编码。', 'listCategoryOptions结果的code', '省略分类', { type: 'string', nullable: true }),
  originalCompanyUpdate: input('是否为原公司更新客商。', 'Portal原公司更新开关', { type: 'boolean' }),
  originalPartyId: optional('原客商ID。', 'originalOptions结果的id', 'originalCompanyUpdate=false时省略', { type: 'string | number', nullable: true, constraints: idRules }),
  supplyChainFinance: optional('是否为供应链金融档案。', 'Portal供应链金融开关', 'false', { type: 'boolean' }),
  bankAccounts: bankInput,
  status: statusInput,
  detail: optional('客商明细/描述。', '详情快照或调用方明确保留值', '省略', { type: 'string', nullable: true, constraints: ['最多500个字符'] }),
  remark: optional('客商备注。', '详情快照或调用方明确保留值', '省略', { type: 'string', nullable: true, constraints: ['最多500个字符'] }),
}
const draftInput = (source: string): AiParameter => input('prepare返回的完整草稿；不要手写、删除展示字段之外的服务端字段。', source, { type: 'object' })
const requestIdInput = input('SDK本地短窗口防重键；不发送给Portal后端，同一创建意图超时重试必须复用。', '调用方用createRequestId()生成并保存', { type: 'string', constraints: ['同键不同草稿会被SDK拒绝', '进程重启或窗口过期不保证防重'] })

export const FINANCE_SETTING_OPENING_SUPPLIER_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-opening-supplier-list': contract({
    purpose: '按客商基础档案页面的筛选和分页规则读取列表。', effect: 'read', inputs: listInputs, output: pageOutput,
    consume: ['用list[].id进入详情、编辑、启停或删除确认；用total继续分页，不能把第一页当作全部客商。', 'status按数值0/1解释为启用/停用；companyName、categoryName只作展示，后续写入仍使用ID或编码。'],
    steps: [{ role: 'optional', when: '用户查看、编辑或执行行操作', capabilityId: 'finance-setting-opening-supplier-get', mapping: { id: 'result.list[].id' }, instruction: '对用户选中的列表行按同一ID读取最新详情，不用行号或名称定位。' }],
    completion: '返回严格的当前筛选页和total；查询本身不修改客商。', idempotency: null,
  }),
  'finance-setting-opening-supplier-category-options': contract({
    purpose: '读取客商表单分类选择器使用的分类候选。', effect: 'read', inputs: {}, output: categoryOutput,
    consume: ['提交分类时使用候选code；id和name只用于解释或展示，不能把name直接当作categoryCode。'], steps: [], completion: '获得当前会话可见的分类候选。', idempotency: null,
  }),
  'finance-setting-opening-supplier-company-tree': contract({
    purpose: '读取客商表单所属公司的树，并标出可选法人节点。', effect: 'read', inputs: {}, output: companyTreeOutput,
    consume: ['只允许选择isCorporation=1的节点作为draft.companyId；name/fullName是展示文本，不能代替ID。'], steps: [], completion: '获得当前会话可见的公司树和法人可选标志。', idempotency: null,
  }),
  'finance-setting-opening-supplier-get': contract({
    purpose: '读取客商详情页、编辑页和写入回查所需的完整快照。', effect: 'read', inputs: { id: input('客商基础档案ID。', '列表list[].id或用户明确确认的详情ID', { type: 'string | number', constraints: idRules }) }, output: detailOutput,
    consume: ['详情中的name、companyId、originalCompanyUpdate、originalPartyId和bankAccounts用于prepareUpdate；展示名称不能直接作为保存ID。'], steps: [], completion: '获得目标客商最新详情；不代表任何写操作已发生。', idempotency: null,
  }),
  'finance-setting-opening-supplier-original-options': contract({
    purpose: '按关键字读取编辑表单的原客商候选，并支持排除当前客商。', effect: 'read', inputs: {
      companyId: optional('可选法人公司ID。', 'Portal原客商选择器上下文', '省略', { type: 'string | number', nullable: true, constraints: idRules }),
      excludeId: optional('编辑时要排除的当前客商ID。', '当前详情id', '省略，不排除记录', { type: 'string | number', nullable: true, constraints: idRules }),
      keyword: input('客商编码或名称关键字。', 'Portal原客商搜索输入', { type: 'string', constraints: ['至少一个非空字符'] }),
    }, output: optionOutput,
    consume: ['用候选id填originalPartyId；不能选择当前记录自身，也不能把name当作ID。'], steps: [], completion: '返回当前关键字下可选的原客商候选。', idempotency: null,
  }),
  'finance-setting-opening-supplier-generate-code': contract({
    purpose: '复现Portal在选择所属法人公司后生成客商编码的联动读取。', effect: 'read', inputs: { companyId: input('所属法人公司ID。', 'companyTree中isCorporation=1的节点ID', { type: 'string | number', constraints: idRules }) }, output: { shape: 'string', fields: [field('$', 'string', '按所属公司生成的客商编码；不是客商主键')], empty: '后端返回空值或请求失败时抛错；不要在调用方手工拼编码。' },
    consume: ['将字符串作为code预览；autoAssignCode仍由用户确认，code不能当作客商ID。'], steps: [], completion: '获得页面可展示的编码预览；不代表客商已写入。', idempotency: null,
  }),
  'finance-setting-opening-supplier-prepare-create': contract({
    purpose: '按Portal创建表单规则校验并生成无副作用的客商创建草稿。', effect: 'prepare', inputs: createInputs, output: { shape: '{ draft: object }', fields: draftFields, empty: '名称、公司、原客商关系、编码或银行账户规则不合法时抛错，不返回半成品草稿。' },
    consume: ['将draft展示给用户确认；银行空行已经丢弃，展示字段不会进入保存载荷。'], steps: [{ role: 'required', when: '用户确认创建', capabilityId: 'finance-setting-opening-supplier-create', mapping: { draft: 'result.draft' }, instruction: '只把prepare返回的draft交给create。' }, { role: 'cancel', when: '用户在提交前取消创建', instruction: '丢弃draft，不调用create。' }], completion: '得到符合Portal创建规则、尚未发网络请求的草稿。', idempotency: null,
  }),
  'finance-setting-opening-supplier-create': contract({
    purpose: '提交一份已确认的客商基础档案创建草稿。', effect: 'write', inputs: { draft: draftInput('finance-setting-opening-supplier-prepare-create.result.draft'), requestId: requestIdInput }, output: { shape: 'string | number', fields: [field('$', 'string | number', '新建客商主键ID', { constraints: idRules })], empty: '后端没有返回合法ID时抛错，不能报告创建成功。' },
    consume: ['保存返回ID，随后get同一ID核对名称、公司、编码、原客商关系和银行账户；返回ID前不要将创建视为完成。'], steps: [{ role: 'required', when: '返回ID或请求超时需要确认终态', capabilityId: 'finance-setting-opening-supplier-get', mapping: { id: 'result.$' }, instruction: '用返回的同一ID回查详情，核对服务端最终编码和全部页面字段。' }], completion: '返回合法ID且详情回查确认客商已按预期落库。', idempotency: 'invoke绑定financeSettingOpeningSupplier.createIdempotent，在当前SDK进程、用户、租户和能力范围内按requestId及草稿指纹短窗口防重；requestId不进入Portal body。直接create不防重。',
  }),
  'finance-setting-opening-supplier-prepare-update': contract({
    purpose: '基于最新客商快照合并Portal允许的编辑字段，生成完整更新草稿和操作前快照。', effect: 'prepare', inputs: { current: input('最新客商详情或列表完整行。', 'finance-setting-opening-supplier-get结果或list.list[]', { type: 'object' }), changes: optional('用户明确修改的分类、原公司关系、供应链金融标识、银行账户、明细或备注。', '用户编辑意图', '沿用current', { type: 'object', nullable: true }) }, output: { shape: '{ draft: object, previous: object }', fields: [...draftFields, field('previous', 'object', '编辑前完整保存快照'), field('previous.id', 'string | number', '编辑前同一客商ID', { constraints: idRules })], empty: 'current缺少页面保存字段或changes含不可编辑字段时抛错。' },
    consume: ['保留previous；用户取消时不发请求，超时或需补偿时先get判断终态。'], steps: [{ role: 'required', when: '用户确认编辑保存', capabilityId: 'finance-setting-opening-supplier-update', mapping: { draft: 'result.draft' }, instruction: '只把prepare返回的draft交给update。' }, { role: 'cancel', when: '用户取消编辑', instruction: '丢弃draft，不调用update。' }], completion: '得到含同一客商ID的完整更新草稿和previous，未发网络请求。', idempotency: null,
  }),
  'finance-setting-opening-supplier-update': contract({
    purpose: '提交Portal编辑表单允许修改的客商完整草稿。', effect: 'write', inputs: { draft: draftInput('finance-setting-opening-supplier-prepare-update.result.draft'), 'draft.id': input('编辑目标客商ID。', 'draft中的id', { type: 'string | number', constraints: idRules }) }, output: trueOutput,
    consume: ['true只表示后端返回成功回执；必须按draft.id调用get逐字段核对，不能把回执当作字段已落库的唯一证据。'], steps: [{ role: 'required', when: '更新返回true或请求超时需要确认终态', capabilityId: 'finance-setting-opening-supplier-get', mapping: { id: 'args.draft.id' }, instruction: '按同一ID读取，核对用户修改字段和未修改的公司/编码/银行账户。' }], completion: '后端返回true且get回查确认同一客商达到目标字段。', idempotency: '没有requestId或SDK幂等包装；超时先按同一ID回查，恢复操作也是新的PUT，不能盲目覆盖并发修改。',
  }),
  'finance-setting-opening-supplier-prepare-change-status': contract({
    purpose: '按用户明确的绝对状态生成客商启停草稿。', effect: 'prepare', inputs: { id: input('客商基础档案ID。', '当前列表行id或详情id', { type: 'string | number', constraints: idRules }), status: input('绝对目标状态：0启用或1停用。', '用户明确的启用/停用意图', { type: 'integer', options: statusOptions }) }, output: { shape: '{ draft: { id: string | number, status: integer } }', fields: [field('$', 'object', '启停草稿'), field('draft', 'object', '提交给changeStatus的绝对状态载荷'), field('draft.id', 'string | number', '客商ID', { constraints: idRules }), field('draft.status', 'integer', '目标状态：0启用、1停用', { values: { '0': '启用', '1': '停用' } })], empty: 'ID或状态非法时抛错，不产生草稿。' },
    consume: ['status不是toggle；必须是用户明确确认的0或1。'], steps: [{ role: 'required', when: '用户确认启停', capabilityId: 'finance-setting-opening-supplier-change-status', mapping: { draft: 'result.draft' }, instruction: '提交绝对状态草稿。' }, { role: 'cancel', when: '用户取消启停确认', instruction: '丢弃draft，不调用changeStatus。' }], completion: '获得无副作用的绝对状态草稿。', idempotency: null,
  }),
  'finance-setting-opening-supplier-change-status': contract({
    purpose: '把客商设置为用户确认的绝对启用或停用状态。', effect: 'write', inputs: { draft: draftInput('finance-setting-opening-supplier-prepare-change-status.result.draft'), 'draft.id': input('客商ID。', 'draft中的id', { type: 'string | number', constraints: idRules }), 'draft.status': input('目标绝对状态。', 'draft中的status', { type: 'integer', options: statusOptions }) }, output: trueOutput,
    consume: ['返回true后按draft.id调用get核对status；启用时服务端仍会重新执行唯一性、分类和原客商关系校验。'], steps: [{ role: 'required', when: '启停返回true或请求超时需要确认终态', capabilityId: 'finance-setting-opening-supplier-get', mapping: { id: 'args.draft.id' }, instruction: '读取同一ID确认status已达到目标值。' }], completion: '后端返回true且详情回查确认目标status。', idempotency: '使用绝对状态而非toggle；没有requestId，超时仍须先按同一ID回查。',
  }),
  'finance-setting-opening-supplier-prepare-delete': contract({
    purpose: '准备一个客商删除目标并等待用户确认。', effect: 'prepare', inputs: { id: input('客商基础档案ID。', '当前列表行id', { type: 'string | number', constraints: idRules }) }, output: { shape: '{ draft: { id: string | number } }', fields: [field('$', 'object', '删除草稿'), field('draft', 'object', '待确认删除目标'), field('draft.id', 'string | number', '客商ID', { constraints: idRules })], empty: 'ID非法时抛错；取消不发DELETE。' },
    consume: ['向用户展示待删除列表行并等待明确确认；服务端会拒绝有原客商关系、子记录或业务引用的删除。'], steps: [{ role: 'required', when: '用户明确确认删除', capabilityId: 'finance-setting-opening-supplier-delete', mapping: { draft: 'result.draft' }, instruction: '只提交同一删除草稿。' }, { role: 'cancel', when: '用户取消删除确认', instruction: '丢弃draft，不调用delete。' }], completion: '获得无副作用的删除目标草稿。', idempotency: null,
  }),
  'finance-setting-opening-supplier-delete': contract({
    purpose: '删除一条已确认且未被服务端引用限制拦截的客商档案。', effect: 'write', inputs: { draft: draftInput('finance-setting-opening-supplier-prepare-delete.result.draft'), 'draft.id': input('待删除客商ID。', 'draft中的id', { type: 'string | number', constraints: idRules }) }, output: trueOutput,
    consume: ['返回true后刷新列表并确认同一ID消失；删除不可恢复，超时不能只凭Promise判断终态。'], steps: [{ role: 'required', when: '删除返回true或请求超时需要确认终态', capabilityId: 'finance-setting-opening-supplier-list', mapping: {}, instruction: '使用删除前筛选条件分页回查，确认目标ID不再出现；若仍出现或查询失败，只报告未确认。' }], completion: '删除回执为true且列表回查确认目标ID消失。', idempotency: '删除没有requestId且不可恢复；超时先回查，不能自动重放。',
  }),
  'finance-setting-opening-supplier-download-template': contract({
    purpose: '下载Portal导入客商基础档案使用的Excel模板。', effect: 'read', inputs: {}, output: fileOutput,
    consume: ['保存为fileName指定的客商基础档案导入模板.xlsx；模板中的分类、公司、银行候选用于填写导入数据。'], steps: [], completion: '获得非空Excel模板文件。', idempotency: null,
  }),
  'finance-setting-opening-supplier-prepare-import': contract({
    purpose: '在不发请求的情况下校验客商基础档案导入文件。', effect: 'prepare', inputs: fileInputs, output: { shape: '{ fileName: string, contentType: string, byteLength: integer }', fields: [field('$', 'object', '导入文件预览'), field('fileName', 'string', '文件名'), field('contentType', 'string', 'MIME类型'), field('byteLength', 'integer', '解码后的文件字节数；1至20MB')], empty: '扩展名、Base64、空文件或20MB限制不合法时抛错且不发请求。' },
    consume: ['用户确认预览后再调用import；取消时只丢弃预览，不产生导入。'], steps: [{ role: 'required', when: '用户确认导入文件', capabilityId: 'finance-setting-opening-supplier-import', mapping: { fileName: 'result.fileName', base64: 'user.fileBase64', contentType: 'result.contentType' }, instruction: '把同一文件交给import；导入由Portal/Java按整批规则校验。' }, { role: 'cancel', when: '用户取消导入', instruction: '丢弃文件预览，不调用import。' }], completion: '得到已通过客户端边界校验的文件预览，尚未写入客商。', idempotency: null,
  }),
  'finance-setting-opening-supplier-import': contract({
    purpose: '按Portal multipart协议导入一批客商基础档案。', effect: 'write', inputs: fileInputs, output: { shape: 'integer', fields: [field('$', 'integer', '服务端本次导入成功条数；不是总行数，也不是独立落库证明', { constraints: ['非负整数'] })], empty: '后端未返回非负整数时抛错；任一行校验失败时整批业务失败。' },
    consume: ['导入响应条数仅作为服务端回执；完成后按导入文件中的唯一字段/列表筛选重新查询，核对实际记录。', 'Java导入是整批校验，出现任一行错误不能把部分成功条数当作可交付结果。'], steps: [{ role: 'required', when: '导入返回条数或请求超时需要确认终态', capabilityId: 'finance-setting-opening-supplier-list', mapping: {}, instruction: '按导入前筛选条件分页回查并核对新增记录；不能只凭返回条数报告落库成功。' }], completion: '请求完成且列表回查确认用户需要的客商记录；只拿到条数时只能报告服务端回执。', idempotency: '导入没有requestId或撤销接口；超时先按文件中的编码/名称和公司范围回查，未确认前不要重复整批导入。',
  }),
  'finance-setting-opening-supplier-export': contract({
    purpose: '按客商基础档案当前筛选条件导出Excel。', effect: 'read', inputs: exportInputs, output: fileOutput,
    consume: ['导出不携带pageNo/pageSize或排序键，得到的文件代表当前筛选范围；保存为客商基础档案.xlsx。'], steps: [], completion: '获得非空Excel导出文件；导出本身不修改客商。', idempotency: null,
  }),
}

export const FINANCE_SETTING_OPENING_SUPPLIER_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_OPENING_SUPPLIER_METHODS).map(([capabilityId, method]) => [
    `financeSettingOpeningSupplier.${method}`,
    FINANCE_SETTING_OPENING_SUPPLIER_AI_CONTRACTS[capabilityId]!,
  ]),
)
FINANCE_SETTING_OPENING_SUPPLIER_METHOD_CONTRACTS['financeSettingOpeningSupplier.create'] = {
  ...FINANCE_SETTING_OPENING_SUPPLIER_METHOD_CONTRACTS['financeSettingOpeningSupplier.create']!,
  inputs: Object.fromEntries(Object.entries(FINANCE_SETTING_OPENING_SUPPLIER_METHOD_CONTRACTS['financeSettingOpeningSupplier.create']!.inputs).filter(([name]) => name !== 'requestId')),
  idempotency: '直接sdk.financeSettingOpeningSupplier.create不防重；AI优先通过invoke("finance-setting-opening-supplier-create", { draft, requestId })使用createIdempotent。',
}
