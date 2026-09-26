import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_LEDGER_ACCOUNTS_METHODS } from '../capabilities/finance-ledger-accounts.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path, type, meaning, optional: false, nullable: false, ...extra,
})
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning, source, required: true, ...extra,
})
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, {
  required: false, omitted, ...extra,
})

const statusOptions = [{ value: 0, label: '启用' }, { value: 1, label: '停用' }]
const id = input('会计科目主键ID；不是科目编码、上级ID、组织ID或字典条目ID', 'finance-ledger-account-list树节点id 或 create根返回值', {
  type: 'string | number', constraints: ['安全正整数或十进制正整数字符串；长ID保留字符串'],
})
const status = input('绝对目标状态；0启用、1停用，不是“切换”命令', '用户意图与最新树节点status共同决定', {
  type: 'integer', options: statusOptions, constraints: ['只能传数值0或1；当前0要停用传1，当前1要启用传0'],
})
const requestId = input('SDK短窗口防重键；不发送给Portal后端', '调用方用createRequestId()为本次写入意图生成；同一意图超时重试复用', {
  type: 'string', constraints: ['新意图换新值；同键不同载荷会被SDK拒绝；跨进程不共享'],
})
const dictValue = (type: string, meaning: string, defaultValue?: string): AiParameter => optional(
  meaning,
  `base-dict-get({dictType:"${type}"}).entries[].value；使用value，不使用entry.id`,
  defaultValue ?? '不限定筛选或按创建页空值发送',
  { type: 'integer' },
)

const queryInputs: Record<string, AiParameter> = {
  name: optional('科目名称包含筛选', '用户提供名称片段', '发送空字符串，不限制名称', { type: 'string' }),
  subjectLevel: optional('科目等级精确筛选；根科目通常为1', '用户提供或来自树节点subjectLevel', '发送空字符串，不限制等级', { type: 'integer', constraints: ['非负整数'] }),
  accountingStandardsApply: dictValue('accounting_standards_apply', '适用会计准则精确筛选'),
  tenantName: optional('企业名称包含筛选；PC只向username严格等于admin的用户显示', '管理员用户输入企业名片段', '发送空字符串；普通用户不要借此猜测跨租户权限', { type: 'string' }),
  organizationId: optional('组织ID精确筛选；不是会计科目ID', 'finance-ledger-account-organization-search.list[].id', '发送空字符串，不限制组织', {
    type: 'string | number', lookup: { capabilityId: 'finance-ledger-account-organization-search', args: {}, valueField: 'list[].id', labelField: 'list[].pathNames' },
  }),
  code: optional('科目编码包含筛选；保留为字符串避免长数字精度损失', '用户提供完整或部分科目编码', '发送空字符串，不限制编码', { type: 'string', constraints: ['只用于筛选；不要把名称填入code'] }),
  status: optional('科目状态精确筛选', '用户意图', 'SDK默认数值0，只查启用科目；页面没有“全部”状态', { type: 'integer', options: statusOptions }),
  ledgerType: dictValue('account_type', '科目类型页签值；后端按科目type精确筛选', 'SDK默认数值1，与PC字典第一项缺失时的fallback一致'),
}

const rowFields: AiField[] = [
  field('[].id', 'string | number', '会计科目主键ID；详情、添加下级和启停使用此值'),
  field('[].tenantName', 'string', '所属企业名称', { nullable: true, nullMeaning: '后端未关联到企业显示名' }),
  field('[].name', 'string', '科目名称'),
  field('[].subjectLevel', 'integer', '科目等级；根通常为1，逐级递增', { nullable: true, nullMeaning: '后端未提供等级' }),
  field('[].code', 'string | number', '完整科目编码；添加下级时作为parentCode，显示时保留原值'),
  field('[].type', 'integer', '科目类型account_type字典value', { nullable: true, nullMeaning: '后端未提供类型' }),
  field('[].subjectFormat', 'integer', '科目格式subject_format字典value', { nullable: true, nullMeaning: '未配置格式' }),
  field('[].useSystemList', 'array', '受控系统字典值数组；空数组表示后端未配置或空串'),
  field('[].useSystemList[]', 'string | number', 'system_tenant_apply_use_system字典value'),
  field('[].parentId', 'string | number', '上级会计科目ID；根标识0或"0"由SDK归一为null', { nullable: true, nullMeaning: '顶级科目' }),
  field('[].pid', 'string | number', '上级会计科目ID的同义响应字段；SDK与parentId取同一来源，并将根标识0或"0"归一为null', { nullable: true, nullMeaning: '顶级科目' }),
  field('[].parentName', 'string', '上级科目名称', { nullable: true, nullMeaning: '顶级科目或后端未补名称' }),
  field('[].ancillaryAccountings', 'array', '辅助核算字段字典值数组；空数组表示未配置'),
  field('[].ancillaryAccountings[]', 'string', 'ancillary_accounting字典value'),
  field('[].balanceDirection', 'integer', '余额方向balance_direction字典value', { nullable: true, nullMeaning: '后端未提供余额方向' }),
  field('[].status', 'integer', '科目状态', { values: { '0': '启用', '1': '停用' } }),
  field('[].accountingStandardsApply', 'integer', '适用会计准则字典value', { nullable: true, nullMeaning: '后端未提供会计准则' }),
  field('[].createTime', 'string | number', '录入时间原值；页面只格式化显示，SDK不猜时区', { nullable: true, nullMeaning: '后端未提供录入时间' }),
  field('[].children', 'array', '直接下级会计科目；每个子节点递归具有与根节点相同字段'),
]

const createInputs: Record<string, AiParameter> = {
  name: input('科目名称', '用户提供', { type: 'string', constraints: ['去首尾空白后非空；后端仅明确校验非空'] }),
  code: input('创建顶级科目时为完整编码；添加下级时只填相对于parentCode的数字后缀', '用户提供并与页面展示的父编码核对', {
    type: 'string', constraints: ['只含十进制数字；parentCode+code不得超过Java Long；不要传科目ID'],
  }),
  type: dictValue('account_type', '科目类型；保存为后端type', 'SDK按创建页默认数值1'),
  subjectFormat: dictValue('subject_format', '科目格式', '发送空字符串，表示页面未选择'),
  useSystem: optional('受控系统字典值数组；可多选', 'base-dict-get({dictType:"system_tenant_apply_use_system"}).entries[].value', 'SDK默认空数组并发送空字符串', {
    type: 'array',
  }),
  'useSystem[]': input('一个受控系统字典value；不是entry.id或标签', '用户在字典候选中选择', { type: 'integer' }),
  ancillaryAccountings: optional('辅助核算字典值数组；可多选', 'base-dict-get({dictType:"ancillary_accounting"}).entries[].value', 'SDK默认空数组', {
    type: 'array',
  }),
  'ancillaryAccountings[]': input('一个辅助核算字典value', '用户在字典候选中选择', { type: 'string' }),
  balanceDirection: dictValue('balance_direction', '余额方向；下级必须与上级一致', 'SDK按创建页默认数值1'),
  accountingStandardsApply: dictValue('accounting_standards_apply', '适用会计准则', 'SDK按创建页默认数值1'),
  pid: optional('上级会计科目ID；添加下级时必填', '最新启用树节点id', '创建顶级科目时发送空字符串', { type: 'string | number', requiredWhen: 'parentCode非空时' }),
  parentName: optional('上级科目名称，只用于提交前人工核对并随PC表单发送', '与pid同一最新树节点name', '创建顶级科目时发送空字符串', { type: 'string', requiredWhen: 'pid非空时' }),
  parentCode: optional('上级完整科目编码；SDK与code后缀直接拼接', '与pid同一最新树节点code转为十进制字符串', '创建顶级科目时省略', { type: 'string', requiredWhen: 'pid非空时', constraints: ['只含十进制数字'] }),
}

const fileInputs: Record<string, AiParameter> = {
  fileName: input('导入文件名，扩展名决定页面可选类型', '用户选择的本地文件原名', { type: 'string', constraints: ['扩展名只能是.xml、.xlsx或.xls，不区分大小写'] }),
  base64: input('导入文件的标准Base64内容；不是data URL', '调用方读取用户明确选择的文件并编码', { type: 'string', constraints: ['不可为空；不要含data:前缀'] }),
  contentType: optional('上传文件MIME类型', '本地文件元数据', 'SDK按扩展名选择application/xml或xlsx MIME', { type: 'string' }),
}

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/ledger-accounts/list.vue',
    kind: 'reference',
    note: '证明筛选、科目类型页签、无分页树列表、添加下级、绝对启停、桥接详情、导入/导出/模板按钮及权限码；当前检出因内网不可达未能pull远端最新。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/ledger-accounts/[mode]/[id].vue 与 detail/[id].vue',
    kind: 'reference',
    note: '证明仅创建不可编辑、页面默认值、父编码拼接、useSystem逗号拼接、创建POST以及详情完全使用列表桥接快照。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 LedgerAccountsController/ServiceImpl/Mapper及VO',
    kind: 'reference',
    note: '证明树返回、筛选、create根Long、启停绝对状态、Excel导入导出字段、重复编码与上下级余额方向校验；当前检出因内网不可达未能pull远端最新。',
  },
  { source: 'src/capabilities/finance-ledger-accounts.ts', kind: 'implementation', note: '证明字段投影、输入保护、父编码拼接、二进制校验及真实请求绑定；不替代部署验证。' },
  { source: 'test/finance-ledger-accounts.test.ts', kind: 'test', note: '离线夹具锁定请求、树结构、创建/启停/文件动作和AI映射；不等于浏览器或真实环境验证。' },
  {
    source: 'baseline/finance-ledger-accounts.browser.json',
    kind: 'browser',
    note: '2026-09-22独立会话确认默认GET逐字段、无module-type和分页参数、表格列、页签、详情/顶级新建/添加下级零额外业务请求及可见动作；未提交写入。',
  },
  {
    source: '2026-09-22 smoke/with-portal-token.sh 公开SDK只读与文件冒烟',
    kind: 'smoke',
    note: '真实树返回45个根节点、递归共155个科目；本地详情、组织关键字候选、目录说明接线通过。导出11281字节、模板3663字节，均验证PK/xlsx签名；响应MIME均为application/vnd.ms-excel;charset=UTF-8。未执行创建、启停或导入。',
  },
]

const gaps = [
  '已取得独立浏览器默认列表、详情与表单基准，但尚未观测非空筛选请求、状态写请求、导入multipart和下载响应的浏览器网络细节。',
  '公开SDK已在真实测试环境验证树读取、本地详情、组织候选、导出、模板下载与说明接线；创建、启停和导入写动作仍未执行。',
  'PC没有删除动作；新建和导入会产生无法从本页清理的记录，因此在没有专用测试数据清理方案前不能执行真实写闭环或宣称创建/导入已验证。',
  '前端文件选择器接受.xml，但固定Java后端使用ExcelUtils.read；XML在真实部署是否可成功解析未验证，不能把扩展名通过等同于导入成功。',
]

const boundaries = [
  '该页面按实时菜单系统选择器属于目标门户系统，虽位于finance目录仍使用platform HTTP实例；一个实例绑定一个用户和租户。',
  '页面无法推导module-type，SDK与当前静态页面行为一致省略该头；仍发送当前会话tenant-id，不以无头扩大数据范围。',
  '列表一次返回筛选后的完整树，PC没有分页器，SDK不接受pageNo/pageSize；children递归同构，不能只读取根节点后称为全部匹配。',
  '当前PC没有编辑、删除、审批、打印动作；后端get/update和其它业务页的科目候选接口没有本页入口，不发布为本页能力。',
  '创建页将organizationId固定为34且未提供组织输入；SDK忠实发送该常量，不把列表organizationId筛选误当创建组织。',
  '详情不发GET：它使用进入详情时的列表行桥接快照；需要最新状态或字段时先刷新列表。',
  '所有字典标签都由运行时base-dict-get解释；契约不固化可运维的account_type、subject_format、受控系统、辅助核算、余额方向或会计准则选项。',
  '导出与模板下载在浏览器中把鉴权信息放URL查询；SDK改用同一绑定会话的请求头取得二进制，不返回或记录token。',
]

function contract (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'> & Partial<Pick<AiContract, 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>>): AiContract {
  return {
    whenToUse: '操作门户系统“财务设置→会计科目”PC页面；不用于其它业务页的科目下拉、凭证模板或账套初始化。',
    boundaries,
    prerequisites: ['已建立带有效会话token与tenantId的SDK；账号须有页面权限及对应create/export/status/detail按钮权限。'],
    failures: [
      'SDK参数或响应形状校验失败时不会伪造空结果或成功；修正参数或核对部署契约后再调用。',
      '401/403、网络或后端业务错误原样抛出；恢复会话/权限后读动作可重试，不能把失败当空树或空文件。',
      '写请求超时或断网时结果不确定：先用列表按ID、名称和编码核实；未核实前不要换requestId重复提交。',
      '后端通用500不能唯一归因；保留原始消息并结合重复编码、父科目余额方向、字典标签和文件内容修正。',
    ],
    evidence,
    gaps,
    ...value,
  }
}

const fileOutput: AiContract['output'] = {
  shape: '{ fileName, contentType, base64, byteLength }',
  fields: [
    field('fileName', 'string', '建议保存的文件名'),
    field('contentType', 'string', '响应MIME类型；缺失时SDK回退xlsx MIME'),
    field('base64', 'string', 'xlsx二进制的标准Base64；解码后写文件，不直接当文本展示'),
    field('byteLength', 'integer', '解码后二进制字节数', { unit: 'byte', constraints: ['大于0'] }),
  ],
  empty: '空响应或不是PK开头的xlsx压缩包会抛错，不返回空base64。',
}

export const FINANCE_LEDGER_ACCOUNTS_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-ledger-account-organization-search': contract({
    purpose: '按名称关键字搜索当前用户角色范围内的组织树，取得会计科目列表organizationId筛选值。',
    effect: 'read',
    inputs: {
      keyword: input('组织名称片段；本地按name.includes匹配', '先向用户取得关键字，不能无关键字拉取长候选', { type: 'string', constraints: ['去首尾空白后非空'] }),
      limit: optional('最多返回候选数', '调用方上下文预算', 'SDK默认20', { type: 'integer', constraints: ['1至50'] }),
    },
    output: { shape: '{ list: OrganizationOption[] }', fields: [
      field('list', 'array', '最多limit个名称匹配候选'), field('list[]', 'object', '一个组织候选'),
      field('list[].id', 'string | number', '组织ID，传列表organizationId'), field('list[].name', 'string', '组织名称'),
      field('list[].pid', 'string | number', '上级组织ID；后端根节点pid=0或"0"由SDK归一为null', { nullable: true, nullMeaning: '树根或后端未提供' }),
      field('list[].pathNames', 'string', '根到该组织的名称路径，用于区分同名项'),
    ], empty: 'list=[]表示当前角色树内无名称匹配；不是跨租户全局无该组织。' },
    consume: ['展示pathNames并让用户确认；后续只传选中项id，不传名称或路径。'],
    steps: [{ role: 'required', when: '用户确认一个候选后筛选会计科目', capabilityId: 'finance-ledger-account-list', mapping: { organizationId: 'result.list[].id' }, instruction: '只选一个候选ID；同名时用pathNames区分。' }],
    completion: '交付可确认的组织候选或明确当前角色树无匹配。', idempotency: null,
  }),

  'finance-ledger-account-list': contract({
    purpose: '按页面筛选条件查询会计科目完整树，并取得详情、添加下级和启停所需的真实ID与字段。',
    effect: 'read', inputs: queryInputs,
    output: { shape: 'FinanceLedgerAccountRow[]', fields: [field('$', 'array', '筛选后的根节点数组；不是分页对象'), field('[]', 'object', '一个根会计科目节点；children递归同构'), ...rowFields], empty: '[]表示当前筛选没有根节点；网络或权限失败会抛错。' },
    consume: ['递归遍历根节点及children；用name/code和字典标签展示，用id执行动作。', '状态0才显示添加下级按钮；停用节点没有添加下级入口。'],
    steps: [
      { role: 'optional', when: '用户要查看一条记录详情', capabilityId: 'finance-ledger-account-detail', mapping: { id: 'result.[].id', name: 'result.[].name', code: 'result.[].code', type: 'result.[].type', subjectFormat: 'result.[].subjectFormat', useSystemList: 'result.[].useSystemList', parentId: 'result.[].parentId', pid: 'result.[].pid', parentName: 'result.[].parentName', ancillaryAccountings: 'result.[].ancillaryAccountings', balanceDirection: 'result.[].balanceDirection', accountingStandardsApply: 'result.[].accountingStandardsApply' }, instruction: 'result.[]代表用户在根或任意children层选中的一个节点；详情是本地快照。' },
      { role: 'optional', when: '用户要给status=0的节点添加下级', capabilityId: 'finance-ledger-account-prepare-create', mapping: { pid: 'result.[].id', parentName: 'result.[].name', parentCode: 'result.[].code', balanceDirection: 'result.[].balanceDirection' }, instruction: '另向用户收集子科目名称、编码后缀与字典项；余额方向不得改成与父级不同。' },
      { role: 'optional', when: '用户要启用或停用选中节点', capabilityId: 'finance-ledger-account-set-status', mapping: { id: 'result.[].id', status: 'user.targetStatus' }, instruction: '目标status取用户意图的绝对值；执行前保存当前status用于必要恢复。' },
      { role: 'optional', when: '用户要导出当前筛选', capabilityId: 'finance-ledger-account-export', mapping: Object.fromEntries(Object.keys(queryInputs).map(key => [key, `args.${key}`])), instruction: '复用原筛选；导出不带分页，因为本页本身不分页。' },
    ],
    completion: '交付完整匹配树或完成用户指定动作的上游选择；不要把根节点数误报为全部节点数。', idempotency: null,
  }),

  'finance-ledger-account-detail': contract({
    purpose: '按列表行快照展示一条会计科目的PC详情字段，不额外发网络请求。',
    effect: 'local', inputs: {
      id, name: input('科目名称', '选中树节点name', { type: 'string' }), code: input('完整科目编码', '选中树节点code', { type: 'string | number' }),
      type: optional('科目类型字典value', '选中树节点type', '允许null，详情显示空值', { type: 'integer', nullable: true, nullMeaning: '未配置' }),
      subjectFormat: optional('科目格式字典value', '选中树节点subjectFormat', '允许null', { type: 'integer', nullable: true, nullMeaning: '未配置' }),
      useSystemList: optional('受控系统字典值数组', '选中树节点useSystemList', '空数组', { type: 'array' }),
      parentId: optional('上级科目ID', '选中树节点parentId', '顶级科目为null', { type: 'string | number', nullable: true, nullMeaning: '顶级科目' }),
      pid: optional('上级科目ID同义字段', '选中树节点pid', '顶级科目为null', { type: 'string | number', nullable: true, nullMeaning: '顶级科目' }),
      parentName: optional('上级科目名称', '选中树节点parentName', '顶级科目为null', { type: 'string', nullable: true, nullMeaning: '页面显示“顶级”' }),
      ancillaryAccountings: optional('辅助核算字典值数组', '选中树节点ancillaryAccountings', '空数组', { type: 'array' }),
      balanceDirection: optional('余额方向字典value', '选中树节点balanceDirection', '允许null', { type: 'integer', nullable: true, nullMeaning: '未配置' }),
      accountingStandardsApply: optional('会计准则字典value', '选中树节点accountingStandardsApply', '允许null', { type: 'integer', nullable: true, nullMeaning: '未配置' }),
    },
    output: { shape: 'FinanceLedgerAccountDetail', fields: rowFields.filter(item => !['[].tenantName', '[].subjectLevel', '[].status', '[].createTime', '[].children'].includes(item.path)).map(item => ({ ...item, path: item.path.replace(/^\[\]\./, '') })), empty: '输入缺少ID、名称或编码时抛错；详情不返回null。' },
    consume: ['用base-dict-get翻译各字典value；parentName为null时页面显示“顶级”。', '这是列表快照；状态等未列字段仍以最新列表为准。'],
    steps: [], completion: '已交付当前快照中的详情字段；无需继续调用后端get。', idempotency: null,
  }),

  'finance-ledger-account-prepare-create': contract({
    purpose: '校验顶级或下级会计科目输入并生成与PC提交一致的创建载荷预览，不写入。',
    effect: 'prepare', inputs: createInputs,
    output: { shape: '{ draft: FinanceLedgerAccountPayload }', fields: [
      field('draft', 'object', '将发送给创建接口的载荷'), field('draft.organizationId', 'integer', 'PC创建页固定常量34'),
      field('draft.name', 'string', '去首尾空白后的科目名称'), field('draft.code', 'string', '顶级完整编码，或parentCode与code后缀拼接结果'),
      field('draft.type', 'integer', '科目类型字典value'), field('draft.subjectFormat', 'integer | string', '科目格式字典value；未选为空字符串'),
      field('draft.useSystem', 'string', '受控系统value用英文逗号拼接；空数组为空字符串'), field('draft.ancillaryAccountings', 'array', '辅助核算value数组'),
      field('draft.ancillaryAccountings[]', 'string', '一个辅助核算value'), field('draft.balanceDirection', 'integer', '余额方向value'),
      field('draft.accountingStandardsApply', 'integer', '适用会计准则value'), field('draft.pid', 'string | number', '上级科目ID；顶级为空字符串'),
      field('draft.parentName', 'string', '上级名称；顶级为空字符串'),
    ], empty: '参数不合法会抛错；不会返回半成品draft。' },
    consume: ['向用户展示完整编码、父科目、方向、准则及多选字典项；确认这是新增，不是编辑。'],
    steps: [{ role: 'required', when: '用户确认预览后创建', capabilityId: 'finance-ledger-account-create', mapping: { ...Object.fromEntries(Object.keys(createInputs).map(key => [key, `args.${key}`])), requestId: 'context.requestId' }, instruction: 'context.requestId由调用方新生成；传原始参数而不是把draft.useSystem逗号串当数组回传。' }],
    completion: '已生成可审阅载荷；尚未新增记录。', idempotency: null,
  }),

  'finance-ledger-account-create': contract({
    purpose: '创建顶级会计科目，或在启用的列表节点下添加一个下级科目。',
    effect: 'write', inputs: { ...createInputs, requestId },
    output: { shape: 'string | number', fields: [field('$', 'string | number', '新建会计科目主键ID；不是科目编码')], empty: '成功必须返回正ID；缺失或非法ID会抛错。' },
    consume: ['保存返回ID；按名称、科目类型和启用状态刷新完整树并递归定位同一ID。', '核对完整code、父ID、余额方向和其它字段后才能报告创建完成。'],
    steps: [{ role: 'required', when: '创建返回ID或超时后核实', capabilityId: 'finance-ledger-account-list', mapping: { name: 'args.name', ledgerType: 'args.type', status: 'literal:0' }, instruction: 'args.type省略时用页面默认1；递归扫描children寻找result.$这个新ID并核对完整编码。PC没有删除动作，不能承诺撤销。' }],
    completion: '仅当树中读回同一ID及预期字段才报告创建已核实；根ID返回本身不等于闭环。',
    idempotency: 'createIdempotent使用requestId在当前SDK进程、用户、租户、能力的短窗口内防重；后端无幂等。超时先列表核实，同一意图复用原requestId；跨进程或过期后不保证。',
  }),

  'finance-ledger-account-set-status': contract({
    purpose: '把一个会计科目设置为明确的启用或停用状态。',
    effect: 'write', inputs: { id, status },
    output: { shape: 'null', fields: [field('$', 'null', '请求成功后的业务数据；null不是未执行', { nullable: true, nullMeaning: '成功响应不携带更新后记录，必须列表回查' })], empty: '成功返回null；失败抛错。' },
    consume: ['操作前保存最新原status；成功或超时后按目标status刷新树并递归查找同一ID。'],
    steps: [
      { role: 'required', when: '请求返回null或超时后确认终态', capabilityId: 'finance-ledger-account-list', mapping: { status: 'args.status' }, instruction: '逐个account_type页签查找同一ID；找到且status一致才确认。' },
      { role: 'cancel', when: '本次状态修改已核实且用户明确要求恢复，并保存了操作前状态', capabilityId: 'finance-ledger-account-set-status', mapping: { id: 'args.id', status: 'context.previousStatus' }, instruction: 'previousStatus必须来自操作前最新列表；恢复后仍需列表回查。' },
    ],
    completion: '列表回查同一ID为目标status后才报告启停已核实；null只证明请求完成。',
    idempotency: '不使用requestId包装；写的是绝对目标状态，同一ID重复同一status的目标终态相同，但超时仍先查后写，避免并发覆盖。',
  }),

  'finance-ledger-account-export': contract({
    purpose: '按会计科目页面当前筛选导出xlsx文件。', effect: 'read', inputs: queryInputs, output: fileOutput,
    consume: ['Base64解码后按fileName保存；不要把二进制或Base64全文写入日志或对话。', '导出包含后端Excel定义字段，不等于当前树所有内部字段快照。'],
    steps: [], completion: '取得并校验非空xlsx后即可交付文件；不需要再查询列表。', idempotency: null,
  }),

  'finance-ledger-account-download-template': contract({
    purpose: '下载当前会计科目导入模板xlsx。', effect: 'read', inputs: {}, output: fileOutput,
    consume: ['Base64解码后保存为会计科目模板.xlsx；填写“序号、编号、科目类型、会计科目名称、余额方向、适用会计准则”。'],
    steps: [{ role: 'optional', when: '用户已按模板填写并明确要求导入', capabilityId: 'finance-ledger-account-prepare-import', mapping: { fileName: 'user.fileName', base64: 'user.base64', contentType: 'user.contentType' }, instruction: '读取用户完成的本地文件；不要把刚下载的空模板直接导入。' }],
    completion: '已交付经xlsx签名校验的模板文件。', idempotency: null,
  }),

  'finance-ledger-account-prepare-import': contract({
    purpose: '在上传前校验会计科目导入文件名、Base64和非空长度，返回安全预览。', effect: 'prepare', inputs: fileInputs,
    output: { shape: '{ fileName, contentType, byteLength }', fields: [field('fileName', 'string', '将作为multipart文件名上传'), field('contentType', 'string', '将作为文件MIME上传'), field('byteLength', 'integer', '解码后的文件大小', { unit: 'byte' })], empty: '无效扩展名、Base64或空文件会抛错。' },
    consume: ['向用户确认文件名和字节数；本步骤不解析工作簿行，也不证明字典标签或编码合法。'],
    steps: [{ role: 'required', when: '用户确认文件且要执行导入', capabilityId: 'finance-ledger-account-import', mapping: { fileName: 'args.fileName', base64: 'args.base64', contentType: 'args.contentType', requestId: 'context.requestId' }, instruction: 'context.requestId由调用方为这份文件的新导入意图生成。' }],
    completion: '本地文件外层校验完成，尚未写入任何科目。', idempotency: null,
  }),

  'finance-ledger-account-import': contract({
    purpose: '以multipart上传PC支持的会计科目文件，由后端批量创建顶级科目。', effect: 'write', inputs: { ...fileInputs, requestId },
    output: { shape: 'boolean', fields: [field('$', 'boolean', '后端严格返回true才视为导入请求成功', { values: { true: '导入事务已完成' } })], empty: '非true响应会抛错；没有逐行结果对象。' },
    consume: ['请求成功后按文件中的科目类型、名称和编码刷新树逐项核对；true不替代独立回查。', '导入事务遇到未知字典标签、非法数字或重复启用编码会失败；不能据通用500猜唯一坏行。'],
    steps: [{ role: 'required', when: '导入返回true或超时后核实', capabilityId: 'finance-ledger-account-list', mapping: { status: 'literal:0' }, instruction: '从原文件读取预期名称、编码和account_type值，逐页签递归核对；本页没有删除，未核实前不要换requestId重试。' }],
    completion: '仅当树中逐项读回文件预期记录才报告导入已核实；响应true只能报告后端事务返回成功。',
    idempotency: 'importIdempotent以requestId和文件参数指纹在当前SDK进程、用户、租户、能力的短窗口内防重；后端无幂等，跨进程或窗口过期后重复导入可能新增/冲突。',
  }),
}

export const FINANCE_LEDGER_ACCOUNTS_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_LEDGER_ACCOUNTS_METHODS).map(([capabilityId, method]) => {
    const source = FINANCE_LEDGER_ACCOUNTS_AI_CONTRACTS[capabilityId]!
    const signature = method === 'downloadTemplate'
      ? '公开方法签名financeLedgerAccounts.downloadTemplate()，无业务参数。'
      : `公开方法签名financeLedgerAccounts.${method}(args)，单个对象参数；list/export可省略args。能力invoke字段与inputs一致。`
    return [`financeLedgerAccounts.${method}`, {
      ...source,
      boundaries: [...source.boundaries, signature],
    }]
  }),
)
