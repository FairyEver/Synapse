import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_METHODS } from '../capabilities/finance-setting-related-party-settlement-account.js'

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

const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(
  meaning,
  source,
  { required: false, omitted, ...extra },
)

const statusOptions = [{ value: 0, label: '停用' }, { value: 1, label: '启用' }]
const id = input(
  '关联方结算科目配置主键ID；不是付款内容字典条目ID，也不是会计科目ID。长Java Long保留字符串。',
  'finance-setting-related-party-settlement-account-list.list[].id，或create返回值',
  { type: 'string | number', constraints: ['安全正整数或无前导零的正整数字符串'] },
)
const paymentContent = input(
  '付款内容字典值；页面使用finance_related_settlement_content，提交value而不是字典记录id或label。',
  'base-dict-get({dictType:"finance_related_settlement_content"}).entries[].value，或当前配置的paymentContent',
  {
    type: 'string | number',
    lookup: { capabilityId: 'base-dict-get', args: { dictType: 'finance_related_settlement_content' }, valueField: 'entries[].value', labelField: 'entries[].label' },
    constraints: ['必须是当前平台字典中的数字字符串或数值；具体可选值不在SDK中硬编码。'],
  },
)
const subject = (name: string, label: string): AiParameter => input(
  `${label}会计科目主键ID；不是科目编码、名称或字典条目ID。`,
  `finance-ledger-account-list结果中用户选定的科目${name}；需按id提交`,
  {
    type: 'string | number',
    lookup: { capabilityId: 'finance-ledger-account-list', args: { status: 0 }, valueField: '[].id', labelField: '[].name' },
    constraints: ['必须来自启用会计科目候选；长ID保留字符串。科目候选页实际使用/admin-api/finance/ledger-accounts/page并带pageSize=-1。'],
  },
)

const rowFields = (prefix: string): AiField[] => [
  field(`${prefix}.id`, 'string | number', '配置主键ID；详情识别和编辑/启停使用，不是科目ID'),
  field(`${prefix}.paymentContent`, 'string | number', '付款内容字典value；用finance_related_settlement_content解释标签', { nullable: true, nullMeaning: '历史响应没有付款内容；不能自行补选项', source: '后端ResponseVO.paymentContent' }),
  field(`${prefix}.payerDebitSubjectId`, 'string | number', '付款方借方会计科目主键ID', { nullable: true, nullMeaning: '响应没有付款方借方科目；不能用名称反推ID' }),
  field(`${prefix}.payerDebitSubjectName`, 'string', '付款方借方会计科目全路径名称；页面列表展示', { nullable: true, nullMeaning: '后端没有匹配到该科目名称' }),
  field(`${prefix}.payerCreditSubjectId`, 'string | number', '付款方贷方会计科目主键ID', { nullable: true, nullMeaning: '响应没有付款方贷方科目' }),
  field(`${prefix}.payerCreditSubjectName`, 'string', '付款方贷方会计科目全路径名称；页面列表展示', { nullable: true, nullMeaning: '后端没有匹配到该科目名称' }),
  field(`${prefix}.payeeDebitSubjectId`, 'string | number', '收款方借方会计科目主键ID；编辑和保存使用payee字段', { nullable: true, nullMeaning: '响应没有收款方借方科目' }),
  field(`${prefix}.payeeDebitSubjectName`, 'string', '收款方借方会计科目全路径名称；页面列表展示', { nullable: true, nullMeaning: '后端没有匹配到该科目名称' }),
  field(`${prefix}.payeeCreditSubjectId`, 'string | number', '收款方贷方会计科目主键ID；编辑和保存使用payee字段', { nullable: true, nullMeaning: '响应没有收款方贷方科目' }),
  field(`${prefix}.payeeCreditSubjectName`, 'string', '收款方贷方会计科目全路径名称；页面列表展示', { nullable: true, nullMeaning: '后端没有匹配到该科目名称' }),
  field(`${prefix}.status`, 'integer', '配置绝对状态；页面1显示启用、0显示停用', { values: { '0': '停用', '1': '启用' } }),
  field(`${prefix}.remark`, 'string', '后端备注；该页面没有展示或编辑控件', { nullable: true, nullMeaning: '没有备注' }),
]

const rowOutputFields = rowFields('list[]')
const detailOutputFields = [
  field('$', 'object', 'Portal详情表单实际消费的关联方结算科目配置字段'),
  field('id', 'string | number', '配置主键ID；详情识别用'),
  field('paymentContent', 'string | number', '付款内容字典value；页面表单使用该值', { nullable: true, nullMeaning: '详情未返回付款内容，不能自行补选项' }),
  field('payerDebitSubjectId', 'string | number', '付款方借方会计科目主键ID', { nullable: true, nullMeaning: '详情未返回该科目ID' }),
  field('payerCreditSubjectId', 'string | number', '付款方贷方会计科目主键ID', { nullable: true, nullMeaning: '详情未返回该科目ID' }),
  field('payeeDebitSubjectId', 'string | number', '收款方借方会计科目主键ID', { nullable: true, nullMeaning: '详情未返回该科目ID' }),
  field('payeeCreditSubjectId', 'string | number', '收款方贷方会计科目主键ID', { nullable: true, nullMeaning: '详情未返回该科目ID' }),
]
const saveFields = (prefix: string): AiField[] => [
  field(`${prefix}`, 'object', '后端保存请求业务字段；不含科目名称展示字段'),
  field(`${prefix}.id`, 'string | number', '编辑或启停目标配置主键ID', { optional: true }),
  field(`${prefix}.paymentContent`, 'string | number', '付款内容字典value'),
  field(`${prefix}.payerDebitSubjectId`, 'string | number', '付款方借方科目主键ID'),
  field(`${prefix}.payerCreditSubjectId`, 'string | number', '付款方贷方科目主键ID'),
  field(`${prefix}.payeeDebitSubjectId`, 'string | number', '收款方借方科目主键ID'),
  field(`${prefix}.payeeCreditSubjectId`, 'string | number', '收款方贷方科目主键ID'),
  field(`${prefix}.status`, 'integer', '绝对状态；创建默认1', { values: { '0': '停用', '1': '启用' } }),
  field(`${prefix}.remark`, 'string', '可选备注；页面未提供控件', { optional: true, nullable: true, nullMeaning: '不填写备注' }),
]

const listInputs: Record<string, AiParameter> = {
  paymentContent: optional(
    '付款内容筛选字典value；空值不限制付款内容。',
    '用户筛选意图或base-dict-get的value',
    'SDK发送空字符串；不要发送字典label或entry.id',
    { type: 'string | number', nullable: true, nullMeaning: '明确传null时按页面原始值发送；未传时发送空字符串', lookup: { capabilityId: 'base-dict-get', args: { dictType: 'finance_related_settlement_content' }, valueField: 'entries[].value', labelField: 'entries[].label' } },
  ),
  payerSubjectId: optional('付款方科目筛选ID；后端匹配付款方借方或贷方科目。', '用户从finance-ledger-account-list候选选择的会计科目ID', 'SDK发送空字符串，不限制付款方科目', { type: 'string | number', nullable: true, nullMeaning: '不按付款方科目筛选', lookup: { capabilityId: 'finance-ledger-account-list', args: { status: 0 }, valueField: '[].id', labelField: '[].name' } }),
  receiverSubjectId: optional('页面表单中的收款方科目筛选ID。', '用户从finance-ledger-account-list候选选择的会计科目ID', 'SDK发送空字符串，不限制收款方科目', { type: 'string | number', nullable: true, nullMeaning: '不按页面字段筛选收款方科目', lookup: { capabilityId: 'finance-ledger-account-list', args: { status: 0 }, valueField: '[].id', labelField: '[].name' }, constraints: ['Portal源码使用receiverSubjectId；当前Java PageReqVO声明payeeSubjectId，二者不一致，不能据此保证部署后端实际过滤生效。'] }),
  status: optional('配置绝对状态筛选；1启用、0停用。', '用户筛选意图', 'SDK发送null；不限制状态', { type: 'integer', nullable: true, nullMeaning: '不按状态筛选', options: statusOptions }),
  pageNo: optional('从1开始的页码。', '调用方分页状态', 'SDK默认1', { type: 'integer', constraints: ['正整数'] }),
  pageSize: optional('当前页条数。', '调用方分页状态', 'SDK默认20；页面styleV2默认值', { type: 'integer', constraints: ['只能取页面支持的10、20、50或100；不接受-1'] }),
}

const createInputs = {
  paymentContent,
  payerDebitSubjectId: subject('付款方借方', '付款方借方'),
  payerCreditSubjectId: subject('付款方贷方', '付款方贷方'),
  payeeDebitSubjectId: subject('收款方借方', '收款方借方'),
  payeeCreditSubjectId: subject('收款方贷方', '收款方贷方'),
  status: optional('创建记录的绝对状态；页面初始值为1。', '用户明确的启用/停用意图；通常省略', 'SDK默认发送1', { type: 'integer', options: statusOptions }),
  remark: optional('保存备注；页面当前没有输入控件。', '调用方额外提供的后端保存字段', '不发送remark', { type: 'string', nullable: true, nullMeaning: '没有备注' }),
}

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/menus/finance.js:38 与 related-party-settlement-account.vue:1-5',
    kind: 'reference',
    note: '证明菜单标题、页面路径、页面permission和finance菜单来源；当前本地检出落后origin/test/portal/main 2个提交，本轮未执行pull。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/related-party-settlement-account/list.vue',
    kind: 'reference',
    note: '证明分页GET、表单默认值、列表展示字段、创建/状态/详情按钮权限、状态PUT整行展开载荷及没有DELETE按钮；不是浏览器网络实测。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/related-party-settlement-account/[mode]/[id].vue',
    kind: 'reference',
    note: '证明付款内容与四个科目表单字段、POST/PUT保存路径、页面校验名、表单status默认值和详情GET源码路径；源码同时存在payee/receiver字段与GET路径冲突。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/utils/system.js、app/portal/components/portal/finance/dict/select/index.vue、finance/ledger-select/index.vue',
    kind: 'reference',
    note: '证明付款内容选项由平台字典grouped-list会话数据提供，科目选择器调用/admin-api/finance/ledger-accounts/page并带pageSize=-1；不证明本次部署的真实候选集合。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 PaymentSlipSocietyRelatedSettlementSubjectConfigController/ServiceImpl/Mapper及VO',
    kind: 'reference',
    note: '证明后端create/update/get/page路径、保存VO的id/paymentContent/四个payee/payer科目ID/status/remark必填性、启用付款内容唯一校验及分页payeeSubjectId筛选；Java检出落后origin/test/test 12个提交。',
  },
  {
    source: 'src/capabilities/finance-setting-related-party-settlement-account.ts 与 test/finance-setting-related-party-settlement-account.test.ts',
    kind: 'test',
    note: '离线request stub锁定字段投影、默认分页参数、详情/创建/编辑/启停载荷、状态反转、非法响应、权限/moduleType和契约结构；不等于真实环境读写闭环。',
  },
]

const gaps = [
  '本轮未启动浏览器，也未调用真实测试环境；没有独立网络基准、按钮权限返回结果或真实候选集合证据。',
  'Portal源码详情请求是/admin-api/finance/related-party-settlement-account/getConfig，但当前Java controller有效路径是/admin-api/finance/payment-slip-society-related-settlement/subject-config/get；SDK按Portal源码保留getConfig，并把后端冲突作为缺口，不能宣称详情线上可用。',
  'Portal列表筛选字段是receiverSubjectId，而当前Java分页VO/Mapper使用payeeSubjectId；SDK复现页面参数，不保证收款方科目筛选在后端实际生效。',
  'Portal表单模板使用payeeDebitSubjectId/payeeCreditSubjectId，但初始form和校验规则仍使用receiverDebitSubjectId/receiverCreditSubjectId；SDK按后端保存VO要求四个payee/payer科目ID齐全，未把页面校验缺失说成成功。',
  '当前页面没有删除按钮、DELETE请求或可逆删除接口；创建记录只能通过受控运维/数据库方式清理，本任务未执行真实写入。',
  '当前任务禁止真实写接口，因此没有create→list、update→list、setStatus→list的部署回查；写请求超时的最终状态仍需调用方按ID读取确认。',
  '列表源码只声明create/status/detail三个按钮权限，没有edit按钮；表单源码仍保留编辑PUT分支，update能力对应该分支，直接进入edit路由的部署可达性和按钮权限未验证。',
]

const boundaries = [
  '只覆盖该PC菜单页面可达的列表、详情、创建、编辑和启停；不发布后端存在但页面未提供的删除、批量删除或其它关联方结算接口。',
  '列表返回当前页，不是全量；status为1启用、0停用。名称字段由后端按科目ID回填，不能反向作为保存ID。',
  '页面目录moduleType为null，SDK不发送module-type；platform实例仍按当前会话携带tenant-id和token，一个实例只服务一个用户/租户。',
  '页面使用运行时平台字典和会计科目树候选；SDK不硬编码finance_related_settlement_content的部署值，也不把字典entry.id当业务value。',
]

function contract (
  value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'> &
    Partial<Pick<AiContract, 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>>,
): AiContract {
  return {
    whenToUse: '操作门户系统“财务设置→关联方结算科目配置”PC页面；不用于关联方支付申请、普通会计科目维护或其它结算配置页面。',
    boundaries,
    prerequisites: [
      '已建立带有效会话token与tenantId的SDK；账号须有页面permission，创建还须有finance:setting:related-party-settlement-account:create，启停须有finance:setting:related-party-settlement-account:status，详情须有finance:setting:related-party-settlement-account:detail按钮权限；列表没有声明edit按钮权限。',
      '四个科目ID必须来自当前可用的finance-ledger-account-list候选；付款内容必须来自当前finance_related_settlement_content平台字典。',
    ],
    failures: [
      '输入ID、付款内容、状态、分页或保存字段不合法时SDK在发请求前抛错；修正为当前列表/候选值后重试。',
      '401/403、网络或后端业务错误原样抛出，不当成空列表或写入成功；先恢复会话/权限或核实详情路径冲突。',
      '分页响应缺少list/total、行缺少有效主键或状态超出0/1时抛错，不投影成空数据或可操作状态。',
      '写请求返回非true、超时或断网时结果不确定；按同一配置ID重新detail/list核对目标字段，未核实前不要盲目重试。',
    ],
    evidence,
    gaps,
    ...value,
  }
}

const pageOutput: AiContract['output'] = {
  shape: '{ list: array, total: integer }',
  fields: [
    field('$', 'object', '关联方结算科目配置分页结果'),
    field('list', 'array', '当前筛选条件下的当前页记录'),
    field('list[]', 'object', '一条配置记录'),
    ...rowOutputFields,
    field('total', 'integer', '当前paymentContent、payerSubjectId、receiverSubjectId、status筛选条件下的匹配总数', { constraints: ['非负整数；不是当前页条数'] }),
  ],
  empty: 'list=[]且total=0表示当前筛选无记录；超过最后一页时也可能list=[]；权限、网络或响应校验失败抛错。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: detailOutputFields,
  empty: '后端详情为空时SDK抛错，不把null当成不存在之外的业务状态。',
}

const preparedSaveOutput = (label: string): AiContract['output'] => ({
  shape: '{ draft: object, previous?: object }',
  fields: [
    field('$', 'object', label),
    ...saveFields('draft'),
  ],
  empty: '输入字段不完整或非法时抛错；不会返回半成品草稿。',
})

export const FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-related-party-settlement-account-list': contract({
    purpose: '按付款内容、付款方科目、收款方科目和状态分页查询关联方结算科目配置，并返回页面展示与后续操作所需的配置ID、科目ID和状态。',
    effect: 'read',
    inputs: listInputs,
    output: pageOutput,
    consume: [
      '用base-dict-get解释paymentContent，用finance-ledger-account-list的科目树解释科目ID；列表的名称字段是后端回填的展示快照。',
      '按pageNo/pageSize翻页，累计达到total前不要把一页当成全部；保留同一行id和status供详情、编辑或启停使用。',
    ],
    steps: [
      { role: 'optional', when: '用户要查看一条列表记录详情', capabilityId: 'finance-setting-related-party-settlement-account-detail', mapping: { id: 'result.list[].id' }, instruction: '只取用户选定行的id；详情接口路径存在Portal/Java源码冲突，按SDK返回错误判断是否需要人工核实。' },
      { role: 'optional', when: '用户明确要创建新配置', capabilityId: 'finance-setting-related-party-settlement-account-prepare-create', mapping: {}, instruction: '从当前字典和科目候选中分别选择一个付款内容及四个科目ID；不能用名称代替ID。' },
      { role: 'optional', when: '用户明确要改变当前行启停状态', capabilityId: 'finance-setting-related-party-settlement-account-prepare-set-status', mapping: { current: 'result.list[]', targetStatus: 'user.targetStatus' }, instruction: '只选一条当前列表行，targetStatus必须是明确绝对值且与该行status相反。' },
    ],
    completion: '已交付指定筛选条件的当前页和total；本能力不改变配置记录。',
    idempotency: null,
  }),

  'finance-setting-related-party-settlement-account-detail': contract({
    purpose: '按配置主键读取关联方结算科目配置详情，返回Portal详情表单实际映射的付款内容和四个科目ID；不强制列表状态或备注。',
    effect: 'read',
    inputs: { id },
    output: detailOutput,
    consume: ['核对详情的id与请求id一致；用四个科目ID而不是名称准备编辑。', '详情读成功不表示配置可编辑或启停；启停草稿仍必须来自含status的最新列表行。'],
    steps: [],
    completion: '已获得该配置ID的一次详情快照；没有写入，也不能据此报告配置已启用。',
    idempotency: null,
  }),

  'finance-setting-related-party-settlement-account-prepare-create': contract({
    purpose: '校验付款内容和四个会计科目ID，生成创建关联方结算科目配置的完整保存草稿，不发请求。',
    effect: 'prepare',
    inputs: createInputs,
    output: preparedSaveOutput('创建草稿'),
    consume: ['向用户展示paymentContent对应的字典标签和四个科目候选名称；确认status默认为1。', '不要把字典entry.id、科目名称或科目编码写入draft的ID字段。'],
    steps: [{ role: 'required', when: '用户确认创建草稿且四个科目与付款内容均已确认', capabilityId: 'finance-setting-related-party-settlement-account-create', mapping: { paymentContent: 'result.draft.paymentContent', payerDebitSubjectId: 'result.draft.payerDebitSubjectId', payerCreditSubjectId: 'result.draft.payerCreditSubjectId', payeeDebitSubjectId: 'result.draft.payeeDebitSubjectId', payeeCreditSubjectId: 'result.draft.payeeCreditSubjectId', status: 'result.draft.status' }, instruction: '把草稿业务字段原样交给create；页面未提供remark控件时不要编造备注。' }],
    completion: '仅生成本地草稿，尚未创建配置；必须继续调用create才会产生后端记录。',
    idempotency: null,
  }),

  'finance-setting-related-party-settlement-account-create': contract({
    purpose: '提交一份已校验的付款内容和四个科目ID，创建关联方结算科目配置并返回后端分配的主键。',
    effect: 'write',
    inputs: createInputs,
    output: { shape: 'string | number', fields: [field('$', 'string | number', '新建配置主键ID；不是付款内容或会计科目ID')], empty: '返回缺失或非法ID时抛错，不能当成创建成功。' },
    consume: ['create只发送后端保存VO业务字段，status省略时发送1；页面桥接/显示名称字段不进入创建体。', '返回ID后按同一付款内容回list，必须按ID核对paymentContent、四个科目ID和status；返回ID不是独立的落库证明。'],
    steps: [
      { role: 'required', when: 'create返回ID或请求超时，需要确认最终状态', capabilityId: 'finance-setting-related-party-settlement-account-list', mapping: { paymentContent: 'args.paymentContent' }, instruction: '分页读取并按返回的result.$精确匹配同一id，再核对四个科目ID和status；找不到时结果不确定。' },
      { role: 'cancel', when: '用户要求撤销已创建配置', instruction: '本页面与当前后端没有DELETE或可逆创建接口；不要伪造cancel调用。需要清理时只能转交部署方受控运维流程。' },
    ],
    completion: '只有创建ID并由list按同一ID核实字段后，才能报告配置已创建；不会自动报告付款申请已生效。',
    idempotency: '后端没有requestId或幂等键，SDK不生成；超时可能已创建，先按ID/字段核实，未核实前不要重复创建。启用状态的同一paymentContent可能被后端唯一性校验拒绝。',
  }),

  'finance-setting-related-party-settlement-account-prepare-update': contract({
    purpose: '基于最新配置行合并付款内容、四个科目或备注变更，生成保留id和status的完整编辑草稿，不发请求。',
    effect: 'prepare',
    inputs: { current: input('当前完整配置行；必须包含id、paymentContent、四个科目ID和status。', '同一次最新list或detail结果', { type: 'object' }), changes: optional('编辑差异；只允许paymentContent、四个科目ID和remark。', '用户确认的字段变更', '保持current对应字段不变', { type: 'object' }) },
    output: preparedSaveOutput('编辑草稿与当前值快照'),
    consume: ['比较draft与previous；status不是页面编辑控件，SDK沿用current.status。', '四个payee/payer字段都必须保留，不能把Portal表单中的receiver字段当作后端保存字段。'],
    steps: [{ role: 'required', when: '用户确认编辑草稿', capabilityId: 'finance-setting-related-party-settlement-account-update', mapping: { draft: 'result.draft' }, instruction: '把完整draft交给update；字段变更后重新prepare，不要手改旧draft。' }],
    completion: '仅完成本地合并与校验，尚未编辑后端记录。',
    idempotency: null,
  }),

  'finance-setting-related-party-settlement-account-update': contract({
    purpose: '提交一份包含配置主键、付款内容、四个科目ID和绝对状态的完整编辑保存草稿。',
    effect: 'write',
    inputs: { draft: input('prepareUpdate返回的完整保存草稿；id、paymentContent、四个科目ID、status不可删除。', 'finance-setting-related-party-settlement-account-prepare-update.result.draft', { type: 'object' }), 'draft.id': id, 'draft.status': input('编辑草稿中的绝对状态；沿用prepare时的当前状态。', 'draft.status', { type: 'integer', options: statusOptions }) },
    output: { shape: 'boolean', fields: [field('$', 'boolean', '后端update业务成功标志；SDK只接受true', { values: { true: '更新接口成功' } })], empty: '后端返回false、缺失或其它值时抛错。' },
    consume: ['SDK向PUT只发送后端保存VO字段，不发送科目名称；true只证明接口接受，不含更新后记录。', '成功或超时后按draft.id重新detail/list，核对付款内容、四个科目ID、status和备注。'],
    steps: [
      { role: 'required', when: 'PUT返回true或超时，需要确认终态', capabilityId: 'finance-setting-related-party-settlement-account-detail', mapping: { id: 'args.draft.id' }, instruction: '读取同一id并逐字段核对draft；详情路径冲突时改用列表回查或转人工核实。' },
      { role: 'cancel', when: '用户明确要求撤销本次已核实编辑且仍保存previous', capabilityId: 'finance-setting-related-party-settlement-account-update', mapping: { draft: 'context.previousDraft' }, instruction: '把prepareUpdate.previous作为补偿写重新PUT，并再次回查；这是补偿写，不是事务回滚。' },
    ],
    completion: '只有回查同一id的业务字段与draft一致，才能报告编辑已核实；不会报告审批或付款业务已完成。',
    idempotency: '后端没有requestId或版本号；重复PUT可能覆盖并发编辑。超时先回查，未确认前不要重试旧draft。',
  }),

  'finance-setting-related-party-settlement-account-prepare-set-status': contract({
    purpose: '基于最新完整列表行生成把关联方结算科目配置切换到明确0/1状态的整行草稿，并保存previous用于补偿。',
    effect: 'prepare',
    inputs: { current: input('最新完整配置行；其status作为当前状态，显示名称也会随Portal状态动作进入请求体。', '同一次list结果中的list[]', { type: 'object' }), targetStatus: input('绝对目标状态；0停用、1启用，不是无条件toggle。', '用户明确意图', { type: 'integer', options: statusOptions, constraints: ['必须与current.status相反'] }) },
    output: { shape: '{ draft: object, previous: object }', fields: [field('$', 'object', '启停草稿和恢复快照'), field('draft', 'object', 'Portal启停动作使用的整行载荷'), ...rowFields('draft'), field('previous', 'object', '操作前整行状态快照'), ...rowFields('previous')], empty: '当前行字段非法或目标状态等于当前状态时抛错。' },
    consume: ['draft保留Portal状态按钮的整行展开语义，并只覆盖status；不要把current.status当成目标状态。', '保存previous.status，后续恢复必须使用同一配置ID和最新回查结果。'],
    steps: [{ role: 'required', when: '用户确认目标状态且草稿来源仍是最新列表行', capabilityId: 'finance-setting-related-party-settlement-account-set-status', mapping: { draft: 'result.draft' }, instruction: '提交完整启停草稿；页面按钮权限为finance:setting:related-party-settlement-account:status。' }],
    completion: '仅生成启停草稿，尚未改变后端状态。',
    idempotency: null,
  }),

  'finance-setting-related-party-settlement-account-set-status': contract({
    purpose: '把一条关联方结算科目配置写成明确的启用或停用状态，复现Portal将整行展开后覆盖status的PUT行为。',
    effect: 'write',
    inputs: { draft: input('prepareSetStatus返回的整行启停草稿；必须包含id、四个科目ID、status及显示快照字段。', 'finance-setting-related-party-settlement-account-prepare-set-status.result.draft', { type: 'object' }), 'draft.status': input('启停草稿中的绝对目标状态。', 'prepareSetStatus.result.draft.status', { type: 'integer', options: statusOptions }) },
    output: { shape: 'boolean', fields: [field('$', 'boolean', '后端update业务成功标志；SDK只接受true', { values: { true: '状态更新接口成功' } })], empty: '返回非true时抛错。' },
    consume: ['请求体包含整行字段并把status设置为draft.status；不要把启停动作理解成DELETE。', '成功或超时后按同一id回查status；只有读回目标值才确认状态生效。'],
    steps: [
      { role: 'required', when: 'PUT返回true或超时，需要确认状态终态', capabilityId: 'finance-setting-related-party-settlement-account-list', mapping: { status: 'args.draft.status' }, instruction: '分页定位同一id并核对status，不能只凭“成功”消息或名称第一条认领。' },
      { role: 'cancel', when: '目标状态已核实且用户明确要求恢复，同时仍保存previous', capabilityId: 'finance-setting-related-party-settlement-account-set-status', mapping: { draft: 'context.previousDraft' }, instruction: '先确认同一id仍为目标状态，再提交previous作为反向PUT；这是补偿写，不是事务回滚。' },
    ],
    completion: 'PUT返回true只表示后端接受；列表回查同一id的status等于目标值后，才能报告启停已核实。',
    idempotency: '没有requestId或后端幂等键；同一绝对status重复提交可能保持同一状态但仍可能覆盖并发整行字段。超时先回查再决定是否重试。',
  }),
}

export const FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_METHODS).map(([capabilityId, method]) => {
    const source = FINANCE_SETTING_RELATED_PARTY_SETTLEMENT_ACCOUNT_AI_CONTRACTS[capabilityId]!
    return [`financeSettingRelatedPartySettlementAccount.${method}`, {
      ...source,
      boundaries: [...source.boundaries, `公开方法 financeSettingRelatedPartySettlementAccount.${method} 接受单个对象参数；invoke始终使用inputs对象。`],
    }]
  }),
)
