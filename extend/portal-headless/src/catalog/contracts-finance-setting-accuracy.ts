import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_ACCURACY_METHODS } from '../capabilities/finance-setting-accuracy.js'

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

const statusOptions = [{ value: 0, label: '启用' }, { value: 1, label: '停用' }]
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不得用租户ID、币种字典值或列表下标代替']

const idInput = input('精度管理主记录ID；不是租户ID、币种字典值或账套ID', 'finance-setting-accuracy-list.list[].id 或 finance-setting-accuracy-create 根返回值', {
  type: 'string | number',
  constraints: idRules,
})

const currencyTypeInput = input('币种字典数值；页面用currency_type选择器展示标签，SDK不把数值猜成币种名称', '用户在精度管理表单的币种选择器中选择；编辑时来自finance-setting-accuracy-get.currencyType', {
  type: 'integer',
  constraints: ['必须是后端接受的安全整数；本页源码未提供完整币种枚举，不得凭经验替换或翻译'],
})

const decimalInput = (label: string, source: string, required = true): AiParameter => input(label, source, {
  type: 'integer',
  required,
  unit: '位',
  constraints: ['只能是0至9的整数；0表示不保留小数位，9表示保留9位'],
})

const pageNo = input('从1开始的页码', '调用方分页状态', {
  type: 'integer',
  required: false,
  omitted: 'SDK默认1',
  constraints: ['正整数'],
})

const pageSize = input('当前页请求条数', '调用方分页需要', {
  type: 'integer',
  required: false,
  omitted: 'SDK默认20，与Portal styleV2列表一致',
  constraints: ['只能取页面支持的10、20、50、100；不接受-1全量'],
})

const requestId = input('SDK进程内创建防重键；不会发送给Portal后端', '调用方为一次新的创建意图生成；同一意图超时重试复用，同载荷变更换新值', {
  type: 'string',
  constraints: ['不能为空；同一创建意图必须复用原值，不能因为请求超时就换键盲目重试'],
})

const currentInput = input('编辑前的完整当前精度值；必须来自最新get详情或此前prepare结果，不能直接使用缺少历史字段的列表行', 'finance-setting-accuracy-get.$ 或 finance-setting-accuracy-prepare-update.draft；prepare-update.previous可用于后续恢复', {
  type: 'object',
  constraints: ['id和status必须来自同一条最新记录；status必须为0；isUsedByAccountSet不能为1；currencyType及三个小数位必须可形成合法表单'],
})

const changesInput = input('本次明确修改的页面字段；省略字段保留current原值', '用户修改意图', {
  type: 'object | null',
  required: false,
  nullable: true,
  omitted: '省略或传null等同于空变更；仅生成与current相同的草稿，不应无意义提交',
  nullMeaning: '没有需要合并的页面字段',
  constraints: ['只允许currencyType、decimalQuantity、decimalUnitPrice、decimalAmount；不能修改id、status、引用标记或历史字段'],
})

const rowFields = (prefix: string): AiField[] => {
  const at = (name: string) => `${prefix}.${name}`
  return [
    field(at('id'), 'string | number', '精度管理主记录ID；编辑、启停和删除都使用它'),
    field(at('tenantName'), 'string', '租户名称；页面企业名称列原文显示', { nullable: true, nullMeaning: '后端未返回租户名称；不据此推断租户ID' }),
    field(at('currencyType'), 'integer', '币种字典数值；页面币种列消费该原值', { nullable: true, nullMeaning: '后端未返回币种；不能自行补成某个币种' }),
    field(at('decimalQuantity'), 'integer', '数量小数位原值', { nullable: true, nullMeaning: '后端未返回该小数位；列表保留null，不自动按0展示', unit: '位', constraints: ['非null时为0至9整数'] }),
    field(at('decimalUnitPrice'), 'integer', '单价小数位原值', { nullable: true, nullMeaning: '后端未返回该小数位；列表保留null，不自动按0展示', unit: '位', constraints: ['非null时为0至9整数'] }),
    field(at('decimalAmount'), 'integer', '金额小数位原值', { nullable: true, nullMeaning: '后端未返回该小数位；列表保留null，不自动按0展示', unit: '位', constraints: ['非null时为0至9整数'] }),
    field(at('status'), 'integer', '绝对状态：0为启用，页面操作显示“停用”；1为停用，页面操作显示“启用”', { values: { '0': '启用', '1': '停用' } }),
    field(at('isUsedByAccountSet'), 'integer', '是否已被账套引用：0否、1是；页面据此隐藏编辑/删除', { nullable: true, nullMeaning: '响应缺少引用标记；SDK不会把null当成已引用，但真实写入前仍需后端校验', values: { '0': '未被账套引用', '1': '已被账套引用' } }),
    field(at('createTime'), 'string | number', '精度记录录入时间；列表原值返回，不做时区换算', { nullable: true, nullMeaning: '后端未返回录入时间', constraints: ['不据字符串格式推断时区'] }),
  ]
}

const detailFields = (prefix: string): AiField[] => {
  const at = (name: string) => prefix ? `${prefix}.${name}` : name
  return [
    field(at('id'), 'string | number', '精度管理主记录ID；不是租户ID'),
    field(at('accuracyName'), 'string', '后端历史名称字段；页面不展示且SDK不接受修改', { nullable: true, nullMeaning: '历史数据没有名称；不要为此字段补造名称' }),
    field(at('currencyType'), 'integer', '币种字典数值；表单必填时由用户选择', { nullable: true, nullMeaning: '详情未返回币种；表单校验不能据此提交' }),
    field(at('accuracyDelimiter'), 'integer', '后端历史精度分隔符；页面不展示且SDK不接受修改', { nullable: true, nullMeaning: '历史数据没有分隔符' }),
    field(at('decimalPlaces'), 'integer', '后端历史小数位字段；页面由三个新小数位字段替代，SDK不接受修改', { nullable: true, nullMeaning: '历史数据没有旧小数位' }),
    field(at('decimalQuantity'), 'integer', '数量小数位；Portal customLoad对null/缺失补0', { unit: '位', constraints: ['0至9整数'] }),
    field(at('decimalUnitPrice'), 'integer', '单价小数位；Portal customLoad对null/缺失补0', { unit: '位', constraints: ['0至9整数'] }),
    field(at('decimalAmount'), 'integer', '金额小数位；Portal customLoad对null/缺失补0', { unit: '位', constraints: ['0至9整数'] }),
    field(at('status'), 'integer', '绝对状态：0启用、1停用；只有0且未被引用时页面允许编辑', { values: { '0': '启用', '1': '停用' } }),
    field(at('isUsedByAccountSet'), 'integer', '是否已被账套引用：0否、1是；1时不能编辑或删除', { nullable: true, nullMeaning: '详情未返回引用标记；不能据此绕过后端保护', values: { '0': '未被账套引用', '1': '已被账套引用' } }),
    field(at('createTime'), 'string | number', '精度记录录入时间；表单回显快照字段，更新时Portal会随表单展开提交', { nullable: true, nullMeaning: '详情未返回录入时间；SDK保留null' }),
    field(at('tenantName'), 'string', '租户名称；表单不展示但Portal编辑提交会随详情快照展开', { nullable: true, nullMeaning: '详情未返回租户名称' }),
  ]
}

const saveFields = (prefix: string): AiField[] => [
  field(`${prefix}.id`, 'string | number', '精度管理主记录ID'),
  field(`${prefix}.accuracyName`, 'string', '保留的历史名称字段；不允许修改', { optional: true, nullable: true, nullMeaning: '当前详情没有历史名称' }),
  field(`${prefix}.currencyType`, 'integer', '更新后的币种字典数值'),
  field(`${prefix}.accuracyDelimiter`, 'integer', '保留的历史分隔符；不允许修改', { optional: true, nullable: true, nullMeaning: '当前详情没有历史分隔符' }),
  field(`${prefix}.decimalPlaces`, 'integer', '保留的历史小数位；不允许修改', { optional: true, nullable: true, nullMeaning: '当前详情没有历史小数位' }),
  field(`${prefix}.decimalQuantity`, 'integer', '更新后的数量小数位', { unit: '位', constraints: ['0至9整数'] }),
  field(`${prefix}.decimalUnitPrice`, 'integer', '更新后的单价小数位', { unit: '位', constraints: ['0至9整数'] }),
  field(`${prefix}.decimalAmount`, 'integer', '更新后的金额小数位', { unit: '位', constraints: ['0至9整数'] }),
  field(`${prefix}.status`, 'integer', '更新请求固定为0；编辑停用记录不符合页面按钮条件', { values: { '0': '启用' } }),
  field(`${prefix}.isUsedByAccountSet`, 'integer', '当前引用标记；仅随Portal详情快照带回，不能由调用方改写', { optional: true, nullable: true, nullMeaning: '详情没有引用标记' }),
  field(`${prefix}.createTime`, 'string | number', '当前详情的录入时间快照；不作为编辑字段', { optional: true, nullable: true, nullMeaning: '详情没有录入时间' }),
  field(`${prefix}.tenantName`, 'string', '当前详情的租户名称快照；不作为编辑字段', { optional: true, nullable: true, nullMeaning: '详情没有租户名称' }),
]

const evidence: AiContract['evidence'] = [
  {
    source: 'generated/page-catalog.json:item menuPath=/dashboard/finance/setting/accuracy/list',
    kind: 'reference',
    note: '证明当前目录项的标题为精度管理、permission=/dashboard/finance/setting/accuracy、kind=列表页(声明式 getDataListURL)、write=true、menuSource=app/portal/menus/finance.js、moduleType=null；生成物只作为目录证据，不替代线上验证。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/accuracy/list.vue',
    kind: 'reference',
    note: '证明列表无筛选form、styleV2分页默认20、列字段、platform实例、创建/编辑/删除/启停按钮条件、按钮权限码及page/delete/enableOrStop路径；本轮未启动浏览器。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/accuracy/[mode]/[id].vue',
    kind: 'reference',
    note: '证明编辑页GET详情、三个null小数位补0、创建/编辑表单字段、校验范围以及表单展开后的POST/PUT提交；固定检出未按本代理约束pull，不能把它称为最新部署证据。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 common/libs/renren/list.js、form.js 与 app/portal/main.js',
    kind: 'reference',
    note: '证明列表请求键序为order、orderField、pageNo、pageSize，平台默认分页名为pageSize；证明编辑表单customLoad后以对象展开提交。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 AccuracyManageController、AccuracyManageSaveReqVO、AccuracyManageRespVO、ServiceImpl、Mapper及PageReqVO',
    kind: 'reference',
    note: '证明后端端点、返回字段、ID/状态/小数位约束、isUsedByAccountSet引用保护、删除为物理删除、更新/启停返回true；固定检出未pull，且没有真实部署回查。',
  },
  {
    source: 'src/capabilities/finance-setting-accuracy.ts',
    kind: 'implementation',
    note: '证明SDK请求键序、页面字段投影、详情兼容字段、表单默认值、编辑/删除按钮保护及返回值校验；实现证据不替代浏览器或真实环境证据。',
  },
  {
    source: 'test/finance-setting-accuracy.test.ts',
    kind: 'test',
    note: '离线锁定默认请求、空值归一、表单载荷、状态/引用保护、HTTP上下文和AI映射；测试不发真实网络。',
  },
]

const gaps = [
  '本轮未启动浏览器，未取得该页独立网络基准、部署响应空值变体、真实权限结果或线上字段键序；请求和字段语义来自固定Portal/Java源码与离线测试推断。',
  '固定Portal检出d3cf56bdc7与固定Java检出dcb3f360194未按本代理禁令pull到远端最新；远端引用虽未显示目标路径差异，仍不能替代最新检出证明。',
  '未在真实测试环境执行创建、编辑、启停、删除，未做prepare→submit→cancel闭环或真实清理；create的本地幂等和反向删除步骤是操作契约，不是线上写入证据。',
  '币种currency_type的实际字典标签、后端部署是否返回全部历史兼容字段以及停用/引用记录的真实页面响应尚未实测；SDK保留数值和null，不猜标签或状态外的业务含义。',
]

const boundaries = [
  '只覆盖Portal PC页面及其新增/编辑子页实际可达的分页、详情、创建、编辑、启停和删除；后端getAll/export-excel及其它页面的候选调用不发布为本页能力。',
  '页面目录permission=/dashboard/finance/setting/accuracy；创建、编辑、删除、启停按钮另受finance:setting:accuracy:create/edit/delete/status控制。菜单可见不是后端权限裁决，SDK不据此预判可用性。',
  '页面请求使用platform HTTP实例；页面目录没有可推导module-type，SDK与浏览器行为一致不发送该头。调用方创建HTTP实例时仍必须绑定当前会话token和tenant-id，一个实例只服务一个用户和租户。',
  '列表没有用户筛选字段，固定发送order=""、orderField=""、pageNo和pageSize；pageSize只接受10、20、50、100，不能借此把页面能力扩成后端任意过滤或全量导出。',
  '历史字段accuracyName、accuracyDelimiter、decimalPlaces只为复刻编辑页表单展开提交而保留，页面不展示、AI不能把它们当作可编辑字段；可编辑字段只有currencyType与三个0至9小数位。',
]

const prerequisites = [
  '已建立带有效会话token与tenantId的SDK；账号须具备页面及对应按钮权限，权限不足按Portal错误处理。',
  'ID必须来自当前列表或get详情；编辑/删除必须带同一条最新记录的status和isUsedByAccountSet，不可凭名称、行号或缓存快照猜测。',
]

const failures = [
  'ID、状态、币种或小数位校验失败时不会发请求；小数位必须为0至9整数，启停目标必须与currentStatus相反。',
  '编辑或删除输入显示停用记录、已被账套引用记录或缺少引用状态时，SDK拒绝执行；不要通过省略保护字段绕过页面条件，后端仍会再次校验。',
  '401/403、网络错误、后端业务错误或响应字段/true回执不符合契约时原样抛错，不当成空列表、保存成功或删除成功。',
  '写请求超时或断网时结果不确定：创建先按ID与三类小数位回查；更新和启停先get/list回查同一ID；删除先确认ID是否已经消失，再决定是否重试，不能盲目重复写。',
]

function contract (
  value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'> &
    Partial<Pick<AiContract, 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>>,
): AiContract {
  return {
    whenToUse: '操作门户系统“财务设置 → 精度管理”PC页面；不用于账套管理中的精度候选、不用于其它系统的币种字典，也不用于后端未被本页调用的getAll或Excel导出。',
    boundaries,
    prerequisites,
    failures,
    evidence,
    gaps,
    ...value,
  }
}

const listOutput: AiContract['output'] = {
  shape: '{ list: array, total: integer }',
  fields: [
    field('$', 'object', '精度管理当前分页结果'),
    field('list', 'array', '当前页精度记录；不是全部租户或全部页'),
    field('list[]', 'object', '一条页面列表行，含展示列与行操作保护字段'),
    ...rowFields('list[]'),
    field('total', 'integer', '当前无筛选分页结果的总记录数，不是当前页长度', { constraints: ['非负整数；list=[]且total>0表示当前页为空，不代表全局为空'] }),
  ],
  empty: 'list=[]且total=0表示当前租户/权限范围内没有记录；list=[]且total>0表示请求页没有记录；权限、网络或响应校验失败抛错。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object | null',
  fields: [field('$', 'object | null', '精度管理详情；找不到ID时根返回null', { nullable: true, nullMeaning: '后端按该ID没有精度记录' }), ...detailFields('')],
  empty: 'null表示后端按该ID没有返回精度记录；不能当成空白草稿继续update或remove，先刷新列表。',
}

const createDraftOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('$', 'object', '只读创建准备结果，尚未发送POST'),
    field('draft', 'object', '可映射给createIdempotent的创建载荷'),
    field('draft.currencyType', 'integer', '币种字典数值'),
    field('draft.decimalQuantity', 'integer', '数量小数位，固定0至9整数', { unit: '位' }),
    field('draft.decimalUnitPrice', 'integer', '单价小数位，固定0至9整数', { unit: '位' }),
    field('draft.decimalAmount', 'integer', '金额小数位，固定0至9整数', { unit: '位' }),
    field('draft.status', 'integer', 'Portal新增表单默认状态0启用；调用方不能覆盖为1', { values: { '0': '启用' } }),
  ],
  empty: '输入非法时抛错且不返回空draft；合法输入总会得到status=0的本地草稿。',
}

const boolOutput: AiContract['output'] = {
  shape: 'boolean',
  fields: [field('$', 'boolean', '后端业务成功标志；SDK只接受true，不把其它真值当成功', { values: { true: '后端接受该写请求' } })],
  empty: '成功返回true；false、缺失或其它值都会抛错。true不包含更新后的详情，必须按步骤回查。',
}

const saveOutputFields = (prefix: string): AiField[] => saveFields(prefix)

export const FINANCE_SETTING_ACCURACY_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-accuracy-list': contract({
    purpose: '查询精度管理页面的无筛选分页列表，返回企业、币种、三类小数位、状态、录入时间以及编辑/删除所需的引用标记。',
    effect: 'read',
    inputs: { pageNo, pageSize },
    output: listOutput,
    consume: [
      '展示list[].tenantName、currencyType、decimalQuantity、decimalUnitPrice、decimalAmount、status和createTime；currencyType保持数值，需标签时使用调用方已有字典，不从数值猜币种名称。',
      '保留同一行的id、status、isUsedByAccountSet：编辑先用id调用get，删除把三者映射给remove；启停把id/currentStatus与用户明确的绝对目标status一起提交。',
      'pageNo/pageSize只控制当前页；需要更完整结果时递增pageNo并累计到total，不能把第一页当成全部，也不能用本页能力替代export-excel。',
    ],
    steps: [
      { role: 'optional', when: '用户选定一行并要打开编辑页', capabilityId: 'finance-setting-accuracy-get', mapping: { id: 'result.list[].id' }, instruction: '只取用户选中的同一行id，读取详情后再prepare-update；不要用名称或数组下标代替ID。' },
      { role: 'optional', when: '用户明确要改变一行的启用/停用状态', capabilityId: 'finance-setting-accuracy-set-status', mapping: { id: 'result.list[].id', currentStatus: 'result.list[].status', status: 'user.targetStatus' }, instruction: 'targetStatus必须是用户明确的绝对0或1且与当前值相反；保留当前status用于恢复。' },
      { role: 'optional', when: '用户确认删除一行且当前行允许删除', capabilityId: 'finance-setting-accuracy-remove', mapping: { id: 'result.list[].id', currentStatus: 'result.list[].status', isUsedByAccountSet: 'result.list[].isUsedByAccountSet' }, instruction: '只在status=0且isUsedByAccountSet明确不是1时调用；删除前保留完整行用于回查。' },
    ],
    completion: '已取得请求页及total并交付字段含义；本能力不改变精度记录。',
    idempotency: null,
  }),

  'finance-setting-accuracy-get': contract({
    purpose: '按精度管理主记录ID读取编辑页详情，复刻Portal customLoad的三个空小数位补0行为，并保留表单展开提交所需的历史兼容字段。',
    effect: 'read',
    inputs: { id: idInput },
    output: detailOutput,
    consume: [
      '表单展示和prepare-update使用currencyType、decimalQuantity、decimalUnitPrice、decimalAmount；详情的三个小数位若后端为null或缺失，SDK已按Portal表单逻辑归一为0。',
      '编辑前必须确认status=0且isUsedByAccountSet不是1；status=1或引用标记为1只能读取，不能借get结果绕过页面按钮条件。',
      'accuracyName、accuracyDelimiter、decimalPlaces、createTime、tenantName是详情快照字段；历史字段和响应扩展字段只为复刻Portal更新展开提交，不应被用户当作可编辑输入。',
    ],
    steps: [{ role: 'optional', when: '用户确认要编辑且详情非null、status=0、isUsedByAccountSet不是1', capabilityId: 'finance-setting-accuracy-prepare-update', mapping: { current: 'result.$', changes: 'literal:{}' }, instruction: '把详情对象作为current，再将用户明确修改的四个页面字段放入changes；不要改历史字段、状态或引用标记。' }],
    completion: '已得到该ID的详情对象或明确的null未找到结果；没有发送写请求。',
    idempotency: null,
  }),

  'finance-setting-accuracy-prepare-create': contract({
    purpose: '按精度管理新增表单校验币种与三类小数位，生成status固定为0的本地创建草稿。',
    effect: 'prepare',
    inputs: {
      currencyType: currencyTypeInput,
      decimalQuantity: decimalInput('数量小数位', '用户在新增表单填写', true),
      decimalUnitPrice: decimalInput('单价小数位', '用户在新增表单填写', true),
      decimalAmount: decimalInput('金额小数位', '用户在新增表单填写', true),
    },
    output: createDraftOutput,
    consume: ['向用户展示四个草稿字段；status=0是Portal新增表单默认启用状态，不要求用户另填。', 'prepare只做本地校验，不分配ID、不证明币种有效性或名称唯一性。'],
    steps: [{ role: 'required', when: '用户确认保存且草稿字段已核对', capabilityId: 'finance-setting-accuracy-create', mapping: { currencyType: 'result.draft.currencyType', decimalQuantity: 'result.draft.decimalQuantity', decimalUnitPrice: 'result.draft.decimalUnitPrice', decimalAmount: 'result.draft.decimalAmount', requestId: 'context.requestId' }, instruction: '逐字段调用createIdempotent；requestId为同一创建意图生成并复用的SDK防重键，status由SDK固定为0，不把历史字段加入输入。' }],
    completion: '已形成合法本地草稿；尚未创建精度记录。',
    idempotency: null,
  }),

  'finance-setting-accuracy-create': contract({
    purpose: '使用新增表单的币种和三类小数位创建一条默认启用的精度记录，并返回后端分配的主记录ID。',
    effect: 'write',
    inputs: {
      currencyType: currencyTypeInput,
      decimalQuantity: decimalInput('数量小数位', 'prepare-create.draft.decimalQuantity或用户已确认输入', true),
      decimalUnitPrice: decimalInput('单价小数位', 'prepare-create.draft.decimalUnitPrice或用户已确认输入', true),
      decimalAmount: decimalInput('金额小数位', 'prepare-create.draft.decimalAmount或用户已确认输入', true),
      requestId,
    },
    output: {
      shape: 'string | number',
      fields: [field('$', 'string | number', '新建精度记录主ID；长ID保持字符串，不能当作币种或租户ID')],
      empty: '正常完成返回根ID；ID缺失、非法或请求失败抛错。返回ID本身不等于列表字段已独立核实。',
    },
    consume: ['保存根返回ID；SDK实际POST键序为currencyType、decimalQuantity、decimalUnitPrice、decimalAmount、status，status固定0，requestId只参与SDK本地防重不进入HTTP body。', '创建完成或超时后按同一ID列表/get回查，核对币种、三类小数位和status=0；找不到或多条疑似记录时不要换requestId盲目重试。'],
    steps: [
      { role: 'required', when: 'POST正常返回ID或请求超时需要核实', capabilityId: 'finance-setting-accuracy-list', mapping: {}, instruction: '分页读取列表并精确定位结果.$对应的id，核对四个表单字段与status=0；列表没有筛选参数，必须逐页查找。' },
      { role: 'cancel', when: '创建记录已由列表/get确认，用户明确要求清理且该记录仍为status=0、isUsedByAccountSet=0', capabilityId: 'finance-setting-accuracy-remove', mapping: { id: 'result.$', currentStatus: 'literal:0', isUsedByAccountSet: 'literal:0' }, instruction: '先独立回查同一ID的引用标记，再调用物理删除；删除后继续用list/get确认ID消失。此步骤是新DELETE写入，不是事务回滚。' },
    ],
    completion: '仅在返回ID并通过列表/get逐字段核对后报告创建已验证；没有独立回查时只能报告请求返回ID。',
    idempotency: '后端没有requestId；共享门面上的createIdempotent在当前SDK进程、用户、租户和能力范围内按requestId及载荷短窗口防重，requestId不会发送给Portal。写入超时先回查同一ID/字段，同一创建意图重试复用原requestId；新意图必须换键。',
  }),

  'finance-setting-accuracy-prepare-update': contract({
    purpose: '以最新详情或列表行作为当前值，只合并页面允许编辑的币种和三类小数位，生成更新草稿并保留编辑前快照。',
    effect: 'prepare',
    inputs: {
      current: currentInput,
      'current.id': idInput,
      'current.accuracyName': { ...input('当前详情中的历史名称；不编辑，必须由详情快照保留', 'finance-setting-accuracy-get.accuracyName', { type: 'string', required: false, nullable: true, nullMeaning: '详情没有历史名称' }) },
      'current.currencyType': { ...currencyTypeInput, required: true, nullable: true, type: 'integer | null', nullMeaning: '列表/详情未返回币种，不能形成可提交表单' },
      'current.accuracyDelimiter': { ...input('当前详情中的历史分隔符；不编辑，必须由详情快照保留', 'finance-setting-accuracy-get.accuracyDelimiter', { type: 'integer', required: false, nullable: true, nullMeaning: '详情没有历史分隔符' }) },
      'current.decimalPlaces': { ...input('当前详情中的历史小数位；不编辑，必须由详情快照保留', 'finance-setting-accuracy-get.decimalPlaces', { type: 'integer', required: false, nullable: true, nullMeaning: '详情没有历史小数位' }) },
      'current.decimalQuantity': { ...decimalInput('当前数量小数位', 'finance-setting-accuracy-get.decimalQuantity', true), type: 'integer | null', nullable: true, nullMeaning: '详情缺失时SDK按编辑表单默认0归一' },
      'current.decimalUnitPrice': { ...decimalInput('当前单价小数位', 'finance-setting-accuracy-get.decimalUnitPrice', true), type: 'integer | null', nullable: true, nullMeaning: '详情缺失时SDK按编辑表单默认0归一' },
      'current.decimalAmount': { ...decimalInput('当前金额小数位', 'finance-setting-accuracy-get.decimalAmount', true), type: 'integer | null', nullable: true, nullMeaning: '详情缺失时SDK按编辑表单默认0归一' },
      'current.status': { meaning: '当前绝对状态；必须为0才符合编辑按钮条件', source: 'finance-setting-accuracy-get.status或finance-setting-accuracy-prepare-update.draft.status', required: true, type: 'integer', options: statusOptions },
      'current.isUsedByAccountSet': { meaning: '当前账套引用标记；必须不是1才符合编辑按钮条件', source: 'finance-setting-accuracy-get.isUsedByAccountSet或finance-setting-accuracy-prepare-update.draft.isUsedByAccountSet', required: true, type: 'integer | null', nullable: true, nullMeaning: '未返回引用标记；SDK不把它当已引用，但后端仍会校验' },
      'current.createTime': { meaning: '当前详情录入时间快照；不编辑', source: 'finance-setting-accuracy-get.createTime', required: false, type: 'string | number', nullable: true, nullMeaning: '详情没有录入时间' },
      'current.tenantName': { meaning: '当前租户名称快照；不编辑', source: 'finance-setting-accuracy-get.tenantName', required: false, type: 'string', nullable: true, nullMeaning: '详情没有租户名称' },
      changes: changesInput,
      'changes.currencyType': { ...currencyTypeInput, required: false, source: '用户本次修改；省略保留current.currencyType' },
      'changes.decimalQuantity': { ...decimalInput('新的数量小数位', '用户本次修改；省略保留current.decimalQuantity', false) },
      'changes.decimalUnitPrice': { ...decimalInput('新的单价小数位', '用户本次修改；省略保留current.decimalUnitPrice', false) },
      'changes.decimalAmount': { ...decimalInput('新的金额小数位', '用户本次修改；省略保留current.decimalAmount', false) },
    },
    output: {
      shape: '{ draft: object, previous: object }',
      fields: [field('$', 'object', '本地编辑准备结果，尚未发送PUT'), field('draft', 'object', '合并后的更新草稿'), ...saveOutputFields('draft'), field('previous', 'object', 'prepare时保存的编辑前快照，不是服务端事务版本'), ...saveOutputFields('previous')],
      empty: 'current或changes非法时抛错；合法输入返回draft和previous，不发请求。',
    },
    consume: ['确认draft.id与previous.id一致；draft.status固定0，历史字段和引用/时间快照只能保留，不能从changes改写。', '保存previous及实际提交载荷；prepare不会锁记录，并发更新仍须在提交后重新get/list核对。'],
    steps: [
      { role: 'required', when: '用户确认保存draft', capabilityId: 'finance-setting-accuracy-update', mapping: { current: 'result.draft', changes: 'literal:{}' }, instruction: '把完整draft作为current并传空changes；update会再次执行页面状态/引用保护和字段校验。' },
      { role: 'cancel', when: '编辑已提交并核实，用户明确要求恢复且确认没有要保留的并发修改', capabilityId: 'finance-setting-accuracy-update', mapping: { current: 'result.draft', 'changes.currencyType': 'result.previous.currencyType', 'changes.decimalQuantity': 'result.previous.decimalQuantity', 'changes.decimalUnitPrice': 'result.previous.decimalUnitPrice', 'changes.decimalAmount': 'result.previous.decimalAmount' }, instruction: '恢复是用保存的previous可编辑字段再次PUT，不是服务端回滚；先get确认同一ID当前仍可编辑，恢复后再get/list核对。' },
    ],
    completion: '已得到可提交的更新草稿与旧快照；尚未写入。',
    idempotency: null,
  }),

  'finance-setting-accuracy-update': contract({
    purpose: '提交精度管理编辑页的币种和三类小数位；只允许页面按钮条件满足的启用且未被账套引用记录。',
    effect: 'write',
    inputs: {
      current: currentInput,
      'current.id': idInput,
      'current.currencyType': { ...currencyTypeInput, required: true, nullable: true, type: 'integer | null', nullMeaning: '当前详情未返回币种，不能提交' },
      'current.decimalQuantity': { ...decimalInput('当前数量小数位', 'prepare-update.draft或当前详情', true), type: 'integer | null', nullable: true, nullMeaning: 'SDK按Portal编辑表单默认0处理' },
      'current.decimalUnitPrice': { ...decimalInput('当前单价小数位', 'prepare-update.draft或当前详情', true), type: 'integer | null', nullable: true, nullMeaning: 'SDK按Portal编辑表单默认0处理' },
      'current.decimalAmount': { ...decimalInput('当前金额小数位', 'prepare-update.draft或当前详情', true), type: 'integer | null', nullable: true, nullMeaning: 'SDK按Portal编辑表单默认0处理' },
      'current.status': { meaning: '当前绝对状态；必须为0', source: 'prepare-update.draft.status或最新列表行status', required: true, type: 'integer', options: [{ value: 0, label: '启用' }] },
      'current.isUsedByAccountSet': { meaning: '当前账套引用标记；必须不是1', source: 'prepare-update.draft.isUsedByAccountSet或最新列表行isUsedByAccountSet', required: true, type: 'integer | null', nullable: true, nullMeaning: '未返回引用标记；不能用它绕过后端保护' },
      'current.accuracyName': { meaning: '当前详情的历史名称；不编辑但详情存在时随表单快照保留', source: 'prepare-update.draft.accuracyName', required: false, type: 'string', nullable: true, nullMeaning: '没有历史名称' },
      'current.accuracyDelimiter': { meaning: '当前详情的历史分隔符；不编辑但详情存在时随表单快照保留', source: 'prepare-update.draft.accuracyDelimiter', required: false, type: 'integer', nullable: true, nullMeaning: '没有历史分隔符' },
      'current.decimalPlaces': { meaning: '当前详情的历史小数位；不编辑但详情存在时随表单快照保留', source: 'prepare-update.draft.decimalPlaces', required: false, type: 'integer', nullable: true, nullMeaning: '没有历史小数位' },
      'current.createTime': { meaning: '当前详情录入时间快照；不编辑', source: 'prepare-update.draft.createTime', required: false, type: 'string | number', nullable: true, nullMeaning: '没有录入时间' },
      'current.tenantName': { meaning: '当前详情租户名称快照；不编辑', source: 'prepare-update.draft.tenantName', required: false, type: 'string', nullable: true, nullMeaning: '没有租户名称' },
      changes: changesInput,
      'changes.currencyType': { ...currencyTypeInput, required: false, source: '用户本次修改；省略保留current.currencyType' },
      'changes.decimalQuantity': { ...decimalInput('新的数量小数位', '用户本次修改；省略保留current.decimalQuantity', false) },
      'changes.decimalUnitPrice': { ...decimalInput('新的单价小数位', '用户本次修改；省略保留current.decimalUnitPrice', false) },
      'changes.decimalAmount': { ...decimalInput('新的金额小数位', '用户本次修改；省略保留current.decimalAmount', false) },
    },
    output: boolOutput,
    consume: ['SDK再次生成与Portal表单一致的update对象：详情快照中的历史字段、引用标记、录入时间和租户名称只保留原值；页面可编辑字段按changes覆盖，status固定0。', '后端true只是业务回执，不包含更新后的行；必须用get或无筛选list定位同一ID，核对四个页面字段。'],
    steps: [
      { role: 'required', when: 'PUT返回true或超时后需要核实', capabilityId: 'finance-setting-accuracy-get', mapping: { id: 'args.current.id' }, instruction: '读取同一ID并核对目标currencyType与三个小数位；如果请求超时，先核实再决定是否重试。' },
      { role: 'cancel', when: '更新已核实且用户明确要求恢复，调用方仍保存prepare-update.previous', capabilityId: 'finance-setting-accuracy-update', mapping: { current: 'args.current', 'changes.currencyType': 'context.previousCurrencyType', 'changes.decimalQuantity': 'context.previousDecimalQuantity', 'changes.decimalUnitPrice': 'context.previousDecimalUnitPrice', 'changes.decimalAmount': 'context.previousDecimalAmount' }, instruction: 'context中的旧值必须来自同一次prepare-update.previous；先确认记录仍status=0且未被引用，恢复后重新get核对。' },
    ],
    completion: 'PUT返回true且get/list确认同一ID字段达到目标值后，才能报告编辑已验证；否则报告请求回执或不确定状态。',
    idempotency: '该更新端点没有requestId或SDK幂等包装；同一ID重复提交可能覆盖并发修改。超时先get/list回查，恢复也只是一次新的PUT，不是事务回滚。',
  }),

  'finance-setting-accuracy-set-status': contract({
    purpose: '把一条精度管理记录设置为明确的启用或停用状态；复刻页面行操作的绝对目标状态。',
    effect: 'write',
    inputs: {
      id: idInput,
      currentStatus: input('操作前列表行的当前绝对状态；只用于防止过期切换', 'finance-setting-accuracy-list.list[].status', { type: 'integer', options: statusOptions, constraints: ['必须来自同一次最新列表读取'] }),
      status: input('用户确认的目标绝对状态；不是无条件toggle', '用户意图；当前0时停用传1，当前1时启用传0', { type: 'integer', options: statusOptions, constraints: ['只能传数值0或1，且必须与currentStatus相反'] }),
    },
    output: boolOutput,
    consume: ['SDK只向enableOrStop发送键序为id、status的PUT body，不发送currentStatus或其它表单字段；页面启停按钮不受isUsedByAccountSet限制。', '保存操作前的currentStatus；成功或超时后用无筛选list定位同一ID，确认status等于目标值。'],
    steps: [
      { role: 'required', when: 'PUT返回true或超时后需要核实状态', capabilityId: 'finance-setting-accuracy-list', mapping: {}, instruction: '分页查找args.id并核对其status等于args.status；不能只按企业名或行号认领记录。' },
      { role: 'cancel', when: '目标状态已核实且用户明确要求恢复，并仍保存操作前currentStatus', capabilityId: 'finance-setting-accuracy-set-status', mapping: { id: 'args.id', currentStatus: 'args.status', status: 'context.previousStatus' }, instruction: '先确认同一ID当前确为args.status，再把previousStatus作为新的绝对目标提交；恢复后再次list回查。' },
    ],
    completion: 'PUT返回true且list回查同一ID的status等于目标值后，才能报告启停已验证。',
    idempotency: '该端点没有requestId；目标是绝对状态，重复同一目标通常收敛，但超时必须先回查，不能把“点击切换”盲目重发成相反状态。',
  }),

  'finance-setting-accuracy-remove': contract({
    purpose: '按精度管理主记录ID物理删除一条当前可删除的启用、未被账套引用记录。',
    effect: 'write',
    inputs: {
      id: idInput,
      currentStatus: input('操作前列表行的当前绝对状态；页面删除按钮只在0时显示', 'finance-setting-accuracy-list.list[].status', { type: 'integer', options: statusOptions, constraints: ['必须为0且来自最新列表行'] }),
      isUsedByAccountSet: input('操作前列表行的账套引用标记；页面删除按钮只在不是1时显示', 'finance-setting-accuracy-list.list[].isUsedByAccountSet', { type: 'integer | null', required: true, nullable: true, nullMeaning: '列表未返回引用标记；SDK允许按页面条件发起，但不能把null当成后端无引用证明', options: statusOptions }),
    },
    output: boolOutput,
    consume: ['SDK只向delete发送params={id}；currentStatus和isUsedByAccountSet只用于复刻页面按钮条件，不进入HTTP请求。', '删除是后端物理delete，没有恢复端点；成功或超时后必须list/get回查同一ID是否不再存在。'],
    steps: [{ role: 'required', when: 'DELETE返回true或超时后需要核实', capabilityId: 'finance-setting-accuracy-list', mapping: {}, instruction: '分页查找args.id；明确看不到同一ID才可报告删除已验证，权限/网络错误不能当作已删除。' }],
    completion: '仅在删除回执为true且独立列表/get确认ID消失后报告删除已验证；本能力没有cancel步骤，因为Portal/后端没有可逆恢复接口。',
    idempotency: '该端点没有requestId且删除为物理删除、不可恢复；超时先回查同一ID，已消失时不要重试，仍存在时也要重新确认最新status和引用标记后再决定。',
  }),
}

export const FINANCE_SETTING_ACCURACY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_ACCURACY_METHODS).map(([capabilityId, method]) => {
    const source = FINANCE_SETTING_ACCURACY_AI_CONTRACTS[capabilityId]!
    return [`financeSettingAccuracy.${method}`, {
      ...source,
      boundaries: [...source.boundaries, `公开方法 financeSettingAccuracy.${method} 接受单个对象参数；list可省略对象，字段与inputs一致；create使用门面挂接的createIdempotent。`],
    }]
  }),
)
