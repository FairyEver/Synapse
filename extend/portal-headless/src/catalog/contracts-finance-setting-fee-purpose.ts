import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_FEE_PURPOSE_METHODS } from '../capabilities/finance-setting-fee-purpose.js'

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

const pagePath = '/dashboard/finance/setting/fee-purpose/list'
const permission = '/dashboard/finance/setting/fee-purpose'
const apiRoot = '/admin-api/finance/fee-purpose'
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用申请类型、费用代码、用途文本或列表下标代替']
const statusOptions = [{ value: 0, label: '启用' }, { value: 1, label: '停用' }]
const statusFilterOptions = [{ value: 'all', label: '全部' }, ...statusOptions]

const rowFields = (prefix: string): AiField[] => {
  const at = (name: string) => prefix ? `${prefix}.${name}` : name
  return [
    field(at('id'), 'string | number', '费用用途配置主键；详情、编辑、启停和删除都使用', { constraints: idRules }),
    field(at('applicationType'), 'string', '稳定申请单类型value；来自申请类型候选，不是中文名称'),
    field(at('applicationTypeName'), 'string', '申请类型显示名称；只展示，不作为提交值'),
    field(at('feeCode'), 'string', '费用代码字符串；来自当前申请类型的费用候选，不是费用名称'),
    field(at('feeName'), 'string', '费用显示名称；只展示，不作为提交值'),
    field(at('purpose'), 'string', '费用用途文本；非空白，最多15个Unicode码点'),
    field(at('status'), 'integer', '绝对状态：0启用、1停用；停用记录才显示编辑和删除', { values: { '0': '启用', '1': '停用' } }),
    field(at('createTime'), 'string | number', '创建时间原值；SDK不做时区转换', { nullable: true, nullMeaning: '后端未返回创建时间' }),
    field(at('updateTime'), 'string | number', '更新时间原值；SDK不做时区转换', { nullable: true, nullMeaning: '后端未返回更新时间' }),
  ]
}

const optionFields = (prefix: string): AiField[] => [
  field(`${prefix}.value`, 'string', '候选提交值；申请类型候选是稳定process key，费用候选是费用代码字符串'),
  field(`${prefix}.label`, 'string', '候选展示名称；不能代替value提交'),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: integer }',
  fields: [
    field('$', 'object', '费用用途当前分页结果'),
    field('list', 'array', '当前页列表；不是全部匹配记录'),
    field('list[]', 'object', '一条费用用途列表行'),
    ...rowFields('list[]'),
    field('total', 'integer', '筛选后的总记录数；不是当前页长度', { constraints: ['非负整数'] }),
  ],
  empty: 'list=[]且total=0表示当前筛选没有记录；权限、网络或响应结构失败会抛错，不改写为空列表。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: [field('$', 'object', '费用用途详情'), ...rowFields('')],
  empty: '详情必须包含合法id、申请类型、费用代码、用途和status；后端找不到记录时请求失败。',
}

const optionsOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('$', 'array', '页面下拉候选数组'), field('[]', 'object', '一条下拉候选'), ...optionFields('[]')],
  empty: '[]表示当前租户/权限下没有匹配候选；不代表可把费用名称或申请单名称直接提交。',
}

const createDraftFields: AiField[] = [
  field('$', 'object', '尚未写入的创建草稿'),
  field('draft', 'object', '提交给create的Portal保存字段'),
  field('draft.applicationType', 'string', '稳定申请单类型value；来自application-type-options.value'),
  field('draft.feeCode', 'string', '费用代码字符串；来自fee-options.value，prepare会把数字输入转换成字符串'),
  field('draft.purpose', 'string', '费用用途原文本；非空白且最多15个Unicode码点'),
]

const updateDraftFields: AiField[] = [
  field('$', 'object', '编辑目标草稿和操作前快照'),
  field('draft', 'object', '提交给update的最小Portal载荷'),
  field('draft.id', 'string | number', '被编辑费用用途主键', { constraints: idRules }),
  field('draft.purpose', 'string', '新的费用用途文本；非空白且最多15个Unicode码点'),
  field('previous', 'object', '编辑前补偿快照；不是自动事务回滚'),
  field('previous.id', 'string | number', '与draft相同的费用用途主键', { constraints: idRules }),
  field('previous.purpose', 'string', '编辑前费用用途文本'),
]

const statusOutput: AiContract['output'] = {
  shape: '{ draft: { id, status }, previous: { id, status } }',
  fields: [
    field('$', 'object', '启停目标草稿和操作前快照'),
    field('draft', 'object', '提交给setStatus的绝对目标状态'),
    field('draft.id', 'string | number', '费用用途主键', { constraints: idRules }),
    field('draft.status', 'integer', '目标绝对状态：0启用、1停用', { values: { '0': '启用', '1': '停用' } }),
    field('previous', 'object', '操作前状态快照；可用于显式恢复'),
    field('previous.id', 'string | number', '同一费用用途主键', { constraints: idRules }),
    field('previous.status', 'integer', '操作前绝对状态', { values: { '0': '启用', '1': '停用' } }),
  ],
  empty: 'targetStatus与current.status相同或字段非法时抛错，不生成草稿。',
}

const removeOutput: AiContract['output'] = {
  shape: '{ draft: { id } }',
  fields: [field('$', 'object', '尚未写入的删除草稿'), field('draft', 'object', '提交给remove的删除载荷'), field('draft.id', 'string | number', '停用费用用途主键', { constraints: idRules })],
  empty: '启用记录不能生成删除草稿；删除后页面没有恢复接口。',
}

const listInputs: Record<string, AiParameter> = {
  applicationType: optional('申请单类型value筛选', '页面“所属支出申请单”选择器', '不发送该筛选', { type: 'string', nullable: true, lookup: { capabilityId: 'finance-setting-fee-purpose-application-type-options', args: {}, valueField: '[].value', labelField: '[].label' } }),
  feeCode: optional('费用代码字符串筛选', '页面“所属费用”选择器；必须属于当前applicationType', '不发送该筛选', { type: 'string | number', nullable: true, lookup: { capabilityId: 'finance-setting-fee-purpose-fee-options', args: { applicationType: '$applicationType' }, valueField: '[].value', labelField: '[].label' } }),
  keyword: optional('费用用途关键字', '页面“费用用途”输入框', '去首尾空白后为空则不发送', { type: 'string', nullable: true }),
  status: optional('状态筛选：all全部、0启用、1停用', '页面状态选择器', 'SDK复刻页面初始值0（启用）', { type: 'string | integer', options: statusFilterOptions }),
  pageNo: optional('从1开始的页码', '调用方分页状态', '默认1', { type: 'integer', constraints: ['正整数'] }),
  pageSize: optional('当前页条数', '调用方分页状态', '默认10；页面支持10、20、50、100', { type: 'integer', constraints: ['只能取10、20、50、100'] }),
}

const createInputs: Record<string, AiParameter> = {
  applicationType: input('稳定申请单类型value', 'application-type-options返回的value；用户确认的申请单类型', { type: 'string', lookup: { capabilityId: 'finance-setting-fee-purpose-application-type-options', args: {}, valueField: '[].value', labelField: '[].label' } }),
  feeCode: input('费用代码字符串或可转成字符串的费用代码数字', '当前applicationType下fee-options返回的value；不能传feeName', { type: 'string | number', lookup: { capabilityId: 'finance-setting-fee-purpose-fee-options', args: { applicationType: '$applicationType' }, valueField: '[].value', labelField: '[].label' } }),
  purpose: input('费用用途文本', '用户在新建/编辑表单填写的文本', { type: 'string', constraints: ['去首尾空白后不能为空', '最多15个Unicode码点'] }),
}

const currentInput = input('最新完整费用用途行或详情', 'finance-setting-fee-purpose-list.list[]或finance-setting-fee-purpose-get结果', { type: 'object', constraints: ['必须包含id、applicationType、feeCode、purpose和status', '编辑/删除时status必须为1停用'] })
const changesInput = optional('本次明确编辑变更', '用户确认的编辑差异', '沿用current.purpose', { type: 'object | null', nullable: true, nullMeaning: '没有新的purpose变更', constraints: ['只允许purpose'] })
const draftInput = (source: string): AiParameter => input('prepare返回的完整草稿；不要手写、删字段或把label替代value', source, { type: 'object' })

const boundaries = [
  `只覆盖Portal页面${pagePath}实际可达的列表、详情、新建、编辑、启停、删除和两个级联候选查询；不发布后端${apiRoot}/options为本页能力，因为当前页面没有调用它。`,
  `页面列表和详情权限为${permission}；创建、编辑、启停、删除按钮分别还受finance:fee-purpose:create/update/update-status/delete裁决，SDK不根据菜单可见性预判写入成功。`,
  '页面使用platform实例，module-type按页面推导为null；一个SDK实例只绑定一个用户和租户的会话token，权限最终由Portal后端裁决。',
  '状态是数值绝对值：0启用、1停用。页面只对停用记录显示编辑和删除；启停提交必须显式给出与current.status相反的targetStatus。',
  '申请类型候选来自当前租户已发布流程，费用候选来自申请类型对应的启用字典；名称只展示，提交必须使用候选value，服务端还会校验组合和流程可用性。',
  '删除是服务端逻辑删除且页面没有恢复按钮；用途长度按Java codePoints().count()和Portal Array.from一致，不按UTF-16 code unit计算。',
]

const prerequisites = [
  '已建立带有效会话token与tenantId的platform SDK；调用方应先取得候选value或使用最新详情/列表行。',
  '写操作必须先prepare，再由用户确认后提交；提交成功或超时都要按同一ID回查，不能只看HTTP成功或直接盲重试。',
]

const failures = [
  'ID、状态、候选值、用途文本或分页非法时在发请求前抛错；SDK不把费用名称、申请单名称或列表下标当作提交值。',
  '详情/分页缺少必需字段、分页total非法、候选不是value/label数组或写接口不是true/合法ID时抛错，不改写为空结果或成功。',
  '后端仍会校验申请类型流程是否启用、费用是否属于该类型且字典启用、重复配置、权限和并发状态；SDK本地校验不能替代服务端裁决。',
  '写请求超时结果不确定：create按返回ID或业务字段回查，update/setStatus按同一ID回查；remove只能确认记录已不再可见，不能伪造恢复。',
]

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main app/portal/menus/finance.js、app/portal/views/dashboard/finance/setting/fee-purpose.vue', kind: 'reference', note: '证明菜单路径、页面路由和页面权限。' },
  { source: 'CodeReview_Projects_Js@test/portal/main app/portal/views/dashboard/finance/setting/fee-purpose/list.vue、[mode]/[id].vue、app/portal/utils/finance/fee-purpose.js', kind: 'reference', note: '证明默认筛选、pageSize=10、按钮权限、各端点、级联候选、编辑/删除状态条件、创建feeCode字符串化和15个Unicode码点规则。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test erp-module-finance/.../FeePurposeController、VO、FeePurposeServiceImpl、FeePurposeCatalogService', kind: 'reference', note: '证明后端权限、请求/响应字段、状态保护、逻辑删除、动态候选和申请类型/费用组合校验。' },
  { source: 'src/capabilities/finance-setting-fee-purpose.ts', kind: 'implementation', note: '证明SDK页面上下文、请求载荷、候选value投影、状态保护、Unicode长度校验和严格回执校验。' },
  { source: 'test/finance-setting-fee-purpose.test.ts', kind: 'test', note: '证明逐页静态核对、默认查询、级联候选、表单提交规则、状态/删除权限条件、坏响应和AI反证；测试不发真实网络。' },
]

function contract (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence'> & Partial<Pick<AiContract, 'boundaries' | 'prerequisites' | 'failures' | 'evidence'>>): AiContract {
  return {
    whenToUse: `操作Portal“财务设置→费用用途管理”页面；不要把其它申请页的费用用途候选或当前页面未调用的后端${apiRoot}/options混入本页操作。`,
    boundaries,
    prerequisites,
    failures,
    evidence,
    gaps: [
      '本轮未启动浏览器，未取得该页面独立真实网络基准、实际按钮权限结果或部署响应变体；契约依据已拉取的Portal/Java源码和离线测试。',
      '尚未在真实测试环境执行创建、编辑、启停、删除的prepare→submit→cancel完整写闭环；删除无恢复接口，不能把离线测试称为线上写入证据。',
    ],
    ...value,
  }
}

export const FINANCE_SETTING_FEE_PURPOSE_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-fee-purpose-list': contract({
    purpose: '按费用用途管理页面筛选条件分页读取配置，返回后续详情、编辑、启停和删除所需的完整行。',
    effect: 'read',
    inputs: listInputs,
    output: pageOutput,
    consume: ['展示所属支出申请单、所属费用、费用用途、更新时间和状态；applicationType/feeCode是提交值，名称只展示。', '保留同一行id和status；编辑/删除前先get或使用最新列表行，不能按用途文本定位。', 'list=[]且total=0是业务空结果；不要把它解释成权限成功。'],
    steps: [
      { role: 'optional', when: '用户需要新建费用用途', capabilityId: 'finance-setting-fee-purpose-application-type-options', mapping: { keyword: 'user.applicationTypeKeyword' }, instruction: '先取申请类型value/label候选；用户确认label后保存value。' },
      { role: 'optional', when: '用户选择了申请类型并需要费用候选', capabilityId: 'finance-setting-fee-purpose-fee-options', mapping: { applicationType: 'user.selectedApplicationType.value', keyword: 'user.feeKeyword' }, instruction: '只在已选applicationType后查询费用候选，切换申请类型后清空旧feeCode。' },
      { role: 'optional', when: '用户要编辑或启停某条记录', capabilityId: 'finance-setting-fee-purpose-get', mapping: { id: 'result.list[].id' }, instruction: '使用最新详情确认status和表单字段。' },
    ],
    completion: '返回当前筛选条件下的严格分页结果；不代表任何写入已经发生。',
    idempotency: null,
  }),

  'finance-setting-fee-purpose-get': contract({
    purpose: '读取费用用途详情，为展示或编辑停用记录提供完整字段和状态快照。',
    effect: 'read',
    inputs: { id: input('费用用途主键ID', 'list.list[].id或用户确认的详情ID', { type: 'string | number', constraints: idRules }) },
    output: detailOutput,
    consume: ['展示applicationTypeName、feeName、purpose和status；提交仍使用applicationType、feeCode和id。', '只有status=1时才能继续prepareUpdate或prepareRemove。'],
    steps: [],
    completion: '得到可用于prepareUpdate/prepareRemove或状态操作的最新详情。',
    idempotency: null,
  }),

  'finance-setting-fee-purpose-application-type-options': contract({
    purpose: '查询当前租户已发布且可用的申请类型候选。',
    effect: 'read',
    inputs: { keyword: optional('申请类型名称关键字', '页面申请类型远程搜索框', '空值请求全部页面候选', { type: 'string', nullable: true }) },
    output: optionsOutput,
    consume: ['展示label供用户选择，保留对应value；不要把label写入create.applicationType。', '候选由服务端按当前租户已发布流程过滤，空数组时停止创建并提示重新选择。'],
    steps: [],
    completion: '返回value/label候选数组；不代表用户已取得create权限。',
    idempotency: null,
  }),

  'finance-setting-fee-purpose-fee-options': contract({
    purpose: '在已选申请类型下查询当前可用费用候选。',
    effect: 'read',
    inputs: { applicationType: input('申请单类型value', 'application-type-options.value或当前表单选择值', { type: 'string' }), keyword: optional('费用名称关键字', '页面费用远程搜索框', '空值请求该类型全部页面候选', { type: 'string', nullable: true }) },
    output: optionsOutput,
    consume: ['展示label供用户选择，提交保存时保留对应value作为feeCode。', '申请类型切换后必须丢弃旧候选和旧feeCode；不能把其它类型的费用value复用。'],
    steps: [],
    completion: '返回属于指定申请类型且服务端认为可用的费用value/label数组。',
    idempotency: null,
  }),

  'finance-setting-fee-purpose-prepare-create': contract({
    purpose: '复刻Portal新建表单的申请类型、费用和用途校验，生成只含三个保存字段的草稿。',
    effect: 'prepare',
    inputs: createInputs,
    output: { shape: '{ draft: { applicationType, feeCode, purpose } }', fields: createDraftFields, empty: '字段非法、用途空白或超过15个Unicode码点时抛错，不返回半成品草稿。' },
    consume: ['把draft原样交给create；不要自行加入status、名称、label或id。', '候选组合、流程启用和重复配置由后端最终校验。'],
    steps: [{ role: 'required', when: '用户确认创建且拥有finance:fee-purpose:create权限', capabilityId: 'finance-setting-fee-purpose-create', mapping: { draft: 'result.draft' }, instruction: '只提交prepare返回的draft。' }],
    completion: '生成尚未发网络请求的创建草稿。',
    idempotency: null,
  }),

  'finance-setting-fee-purpose-create': contract({
    purpose: '创建一条启用状态的费用用途配置。',
    effect: 'write',
    inputs: { draft: draftInput('finance-setting-fee-purpose-prepare-create.result.draft') },
    output: { shape: 'string | number', fields: [field('$', 'string | number', '新建费用用途主键；不是申请类型或费用代码', { constraints: idRules })], empty: '后端未返回合法主键时抛错。' },
    consume: ['保存返回ID；随后get或list按ID核对applicationType、feeCode、purpose和status=0。', 'create草稿不含status，服务端固定以0启用。'],
    steps: [
      { role: 'required', when: 'create返回ID或请求超时需要确认终态', capabilityId: 'finance-setting-fee-purpose-get', mapping: { id: 'result.$' }, instruction: '回查同一ID，核对服务端最终记录。' },
      { role: 'cancel', when: '用户明确要撤销已创建的记录且回查确认status=0', instruction: '先prepareSetStatus(current,1)→setStatus停用，再回查并prepareRemove→remove；删除无恢复接口，必须先取得用户确认。' },
    ],
    completion: '返回合法ID且回查确认记录已按预期创建；只看HTTP成功不算完成。',
    idempotency: '没有requestId或SDK幂等包装；超时先按业务字段/ID回查，未确认前不要重复create。',
  }),

  'finance-setting-fee-purpose-prepare-update': contract({
    purpose: '基于最新停用记录合并用户明确的purpose变更，生成Portal编辑最小载荷和补偿快照。',
    effect: 'prepare',
    inputs: { current: currentInput, changes: changesInput },
    output: { shape: '{ draft: { id, purpose }, previous: { id, purpose } }', fields: updateDraftFields, empty: 'current不是停用记录、缺少字段或changes包含非purpose字段时抛错。' },
    consume: ['只把draft提交给update；applicationType和feeCode不可在编辑接口修改。', '保留previous；需要恢复时由用户明确再次update(previous)，不是自动回滚。'],
    steps: [{ role: 'required', when: '用户确认保存编辑', capabilityId: 'finance-setting-fee-purpose-update', mapping: { draft: 'result.draft' }, instruction: '只提交prepare返回的draft。' }],
    completion: '生成未发网络请求的编辑草稿，且draft.id与previous.id一致。',
    idempotency: null,
  }),

  'finance-setting-fee-purpose-update': contract({
    purpose: '修改一条停用状态费用用途的purpose文本。',
    effect: 'write',
    inputs: { draft: draftInput('finance-setting-fee-purpose-prepare-update.result.draft') },
    output: { shape: 'true', fields: [field('$', 'boolean', '后端更新成功回执；固定为true')], empty: '非true回执抛错。' },
    consume: ['返回true后get同一ID确认purpose；后端只允许停用记录更新。', '超时先回查，不要把previous当作已经恢复。'],
    steps: [
      { role: 'required', when: 'update返回true或请求超时需要确认终态', capabilityId: 'finance-setting-fee-purpose-get', mapping: { id: 'context.draft.id' }, instruction: '按同一ID回查最终purpose和status。' },
      { role: 'recovery', when: '用户明确恢复编辑前文本且previous来自同一条记录', capabilityId: 'finance-setting-fee-purpose-update', mapping: { draft: 'context.previous' }, instruction: '将previous作为新的显式编辑草稿提交。' },
    ],
    completion: '返回true且回查确认purpose已更新。',
    idempotency: '更新接口没有requestId；相同draft重复提交通常是同一purpose写入，但超时仍必须先get回查，不要在未确认前盲目重试。',
  }),

  'finance-setting-fee-purpose-prepare-set-status': contract({
    purpose: '根据最新行生成与当前状态相反的绝对启停草稿。',
    effect: 'prepare',
    inputs: { current: currentInput, targetStatus: input('绝对目标状态：0启用或1停用；必须与current.status相反', '用户确认的启用/停用意图', { type: 'integer', options: statusOptions, constraints: ['不能传toggle或与current.status相同'] }) },
    output: statusOutput,
    consume: ['把draft原样交给setStatus；previous只用于用户明确补偿恢复。', '启用操作会由服务端重新校验申请类型流程和费用组合是否仍可用。'],
    steps: [{ role: 'required', when: '用户确认启停', capabilityId: 'finance-setting-fee-purpose-set-status', mapping: { draft: 'result.draft' }, instruction: '提交绝对目标status，不要在调用方再次toggle。' }],
    completion: '生成未发网络请求的启停草稿。',
    idempotency: null,
  }),

  'finance-setting-fee-purpose-set-status': contract({
    purpose: '按绝对status启用或停用费用用途配置。',
    effect: 'write',
    inputs: { draft: draftInput('finance-setting-fee-purpose-prepare-set-status.result.draft') },
    output: { shape: 'true', fields: [field('$', 'boolean', '后端启停成功回执；固定为true')], empty: '非true回执抛错。' },
    consume: ['返回true后get同一ID核对status；启用时还要确认后端组合校验已通过。'],
    steps: [
      { role: 'required', when: 'setStatus返回true或请求超时需要确认终态', capabilityId: 'finance-setting-fee-purpose-get', mapping: { id: 'context.draft.id' }, instruction: '按同一ID回查status，不能按列表位置认领结果。' },
      { role: 'recovery', when: '用户明确恢复操作前状态且previous来自同一条记录', capabilityId: 'finance-setting-fee-purpose-set-status', mapping: { draft: 'context.previous' }, instruction: '把previous作为绝对状态再次提交；这不是事务回滚。' },
    ],
    completion: '返回true且回查确认status等于目标值。',
    idempotency: '启停接口没有requestId；重复提交同一绝对status通常不会改变最终状态，但超时仍必须先get回查，不能盲目重复切换。',
  }),

  'finance-setting-fee-purpose-prepare-remove': contract({
    purpose: '确认记录处于停用状态后生成不可恢复删除载荷。',
    effect: 'prepare',
    inputs: { current: currentInput },
    output: removeOutput,
    consume: ['仅停用记录可生成draft；删除前必须向用户说明页面没有恢复按钮。'],
    steps: [{ role: 'required', when: '用户明确确认删除且记录仍为停用', capabilityId: 'finance-setting-fee-purpose-remove', mapping: { draft: 'result.draft' }, instruction: '只提交prepare返回的draft。' }],
    completion: '生成未发网络请求的删除草稿。',
    idempotency: null,
  }),

  'finance-setting-fee-purpose-remove': contract({
    purpose: '删除一条停用状态的费用用途配置；服务端执行逻辑删除。',
    effect: 'write',
    inputs: { draft: draftInput('finance-setting-fee-purpose-prepare-remove.result.draft') },
    output: { shape: 'true', fields: [field('$', 'boolean', '后端删除成功回执；固定为true')], empty: '非true回执抛错。' },
    consume: ['返回true后list或get确认记录已不再可用；不能把删除当成可逆停用。'],
    steps: [{ role: 'required', when: 'remove返回true或请求超时需要确认终态', capabilityId: 'finance-setting-fee-purpose-list', mapping: {}, instruction: '刷新列表确认记录消失；超时先核对再决定是否重试。' }],
    completion: '返回true且独立查询确认记录已逻辑删除。',
    idempotency: '没有恢复或requestId包装；删除请求超时先回查，不能盲目重复删除或声称可恢复。',
  }),
}

export const FINANCE_SETTING_FEE_PURPOSE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_FEE_PURPOSE_METHODS).map(([id, method]) => [`financeSettingFeePurpose.${method}`, FINANCE_SETTING_FEE_PURPOSE_AI_CONTRACTS[id]!]),
)
