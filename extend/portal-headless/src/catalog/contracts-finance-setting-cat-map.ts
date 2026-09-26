import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_CAT_MAP_METHODS } from '../capabilities/finance-setting-cat-map.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path, type, meaning, optional: false, nullable: false, ...extra,
})

const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning, source, required: true, ...extra,
})

const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, {
  required: false, omitted, ...extra,
})

const financeCategoryLookup = {
  capabilityId: 'finance-setting-cat-map-finance-category-search',
  args: { keyword: '$keyword' },
  valueField: 'list[].id',
  labelField: 'list[].path',
}

const thingCategoryLookup = {
  capabilityId: 'finance-setting-cat-map-thing-category-search',
  args: { keyword: '$keyword' },
  valueField: 'list[].id',
  labelField: 'list[].path',
}

const candidateInputs: Record<string, AiParameter> = {
  keyword: input('要匹配的类目名称关键字；SDK会去首尾空白后在页面返回的整棵树中本地匹配', '用户提供的名称片段', {
    type: 'string',
    constraints: ['不能为空或全为空白；不能用空关键字拉取长候选集'],
  }),
  limit: optional('最多返回的名称匹配候选数', '调用方的上下文预算', 'SDK默认20', {
    type: 'integer',
    constraints: ['只能是1至100的正整数；返回截断时应缩小keyword或提高limit后重查'],
  }),
}

const idInput = input('要废弃的类目对照行ID；不是名称、树层级ID或租户ID', 'finance-setting-cat-map-list[].id，同一条最新类目对照行', {
  type: 'string | number',
  constraints: ['安全正整数或无前导零的正整数字符串；长ID保留字符串'],
})

const createInputs: Record<string, AiParameter> = {
  financeCategoryId: input('要绑定的财务类目主键；与Portal表单“财务类目”相同', 'finance-setting-cat-map-finance-category-search.list[].id；必须由用户从path确认', {
    type: 'string | number',
    lookup: financeCategoryLookup,
    constraints: ['安全正整数或无前导零的正整数字符串；不要传候选数组下标或名称'],
  }),
  thingCategoryIds: input('要绑定的资产类目主键数组；与Portal表单多选树相同', 'finance-setting-cat-map-thing-category-search.list[].id；只收集用户确认且selectable=true的ID', {
    type: 'array',
    lookup: thingCategoryLookup,
    constraints: ['至少一个ID；每个ID必须是安全正整数或无前导零的正整数字符串；保持用户选择顺序'],
  }),
}

const updateInputs: Record<string, AiParameter> = {
  current: input('编辑前的完整类目对照行，或prepareUpdate返回的draft；必须同时含id、financeCategoryId、thingCategoryIds', 'finance-setting-cat-map-list的[]，或finance-setting-cat-map-prepare-update的draft', {
    type: 'object',
    constraints: [
      'current.id是原绑定关系对应的财务类目ID；current.financeCategoryId是当前目标财务类目ID，正常列表行二者相同',
      'current.thingCategoryIds是完整当前资产类目ID数组；不要只传变化字段',
    ],
  }),
  'changes.financeCategoryId': optional('编辑后要绑定的财务类目主键；省略表示沿用current.financeCategoryId', '用户从finance-setting-cat-map-finance-category-search确认的ID', '沿用current.financeCategoryId', {
    type: 'string | number',
    lookup: financeCategoryLookup,
    constraints: ['只允许放在changes.financeCategoryId；不要修改current.id来表示换财务类目'],
  }),
  'changes.thingCategoryIds': optional('编辑后的完整资产类目主键数组；省略表示沿用current.thingCategoryIds', '用户从finance-setting-cat-map-thing-category-search确认的一组ID', '沿用current.thingCategoryIds', {
    type: 'array',
    lookup: thingCategoryLookup,
    constraints: ['出现时至少一个ID；这是替换整组选择，不是增量追加'],
  }),
}

const discardInputs: Record<string, AiParameter> = {
  id: idInput,
  financeCategoryId: input('被废弃映射的财务类目主键；必须与id相同', 'finance-setting-cat-map-list[].financeCategoryId，同一条最新列表行', {
    type: 'string | number',
    constraints: ['必须与id按字符串值相等；不要用新的目标财务类目ID'],
  }),
  thingCategoryIds: input('被废弃行原来绑定的资产类目主键数组；随页面请求发送，可为空数组', 'finance-setting-cat-map-list[].thingCategoryIds，同一条最新列表行', {
    type: 'array',
    constraints: ['可以是空数组；不要凭名称或过期列表拼造'],
  }),
}

const rowFields = (prefix: string): AiField[] => [
  field(`${prefix}.id`, 'string | number', '类目对照行主键；当前Java实现把它设为原财务类目ID，编辑换目标时仍保留它作为旧绑定ID'),
  field(`${prefix}.financeCategoryId`, 'string | number', '当前绑定的财务类目主键；正常列表响应与id相同，编辑请求的目标值可以不同'),
  field(`${prefix}.financeCategoryName`, 'string', '财务类目完整名称路径；服务端用“》》”连接祖先到当前类目，空字符串表示服务端未拼出名称'),
  field(`${prefix}.thingCategoryIds`, 'array', '该财务类目绑定的资产类目主键数组；顺序来自关系表查询，不代表层级顺序'),
  field(`${prefix}.thingCategoryIds[]`, 'string | number', '一个资产类目主键；属于资产类目命名空间，不是财务类目ID'),
  field(`${prefix}.thingCategoryName`, 'array', '页面展示的资产类目完整名称路径数组；可能少于thingCategoryIds，因为后端会跳过取不到路径的项'),
  field(`${prefix}.thingCategoryName[]`, 'string', '一个资产类目名称路径；服务端路径分隔符为“》》”或其下游返回的原始路径'),
  field(`${prefix}.bindTime`, 'string | null', '财务类目最近绑定时间原值；页面只格式化显示，不由SDK猜时区', { nullable: true, nullMeaning: '后端没有绑定时间或序列化为空；不能据此判断未绑定，列表本身只返回已绑定行' }),
]

const saveFields = (prefix: string): AiField[] => [
  field(`${prefix}.thingCategoryIds`, 'array', '完整资产类目ID数组；页面表单字段，创建/编辑校验要求至少一个'),
  field(`${prefix}.thingCategoryIds[]`, 'string | number', '一个资产类目ID；来源于用户确认的资产树候选'),
  field(`${prefix}.financeCategoryId`, 'string | number', '目标财务类目ID；编辑时可以不同于${prefix}.id'),
  field(`${prefix}.status`, 'boolean', '页面表单隐藏默认值，固定为true；不用于切换绑定状态'),
  field(`${prefix}.id`, 'string', '页面表单主键；创建固定为空字符串，编辑保留原绑定财务类目ID'),
]

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/cat-map/list.vue',
    kind: 'reference',
    note: '静态源码证明列表接口、无分页响应标志、order/orderField默认参数、三项按钮权限与discard请求体；本次未启动浏览器，不能替代线上基准。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/cat-map/[mode]/[id].vue 与 app/portal/components/portal/finance/tree-select/{finance-category,thing-category}/index.vue',
    kind: 'reference',
    note: '静态源码证明创建/编辑表单字段初值、必填规则、候选树入口、资产节点isUse禁用映射，以及POST/PUT提交字段；未声称浏览器实测。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 ThingCategoryController/ThingCategoryServiceImpl/ThingCategoryUnionRespVO',
    kind: 'reference',
    note: '静态源码证明page返回全量数组、create根Long、update/discard布尔成功值、废弃清除绑定关系，以及编辑时id与financeCategoryId可分离；固定检出本轮未pull远端。',
  },
  {
    source: 'src/capabilities/finance-setting-cat-map.ts',
    kind: 'implementation',
    note: '实现锁定platform请求实例、moduleType=null、请求键序、响应字段校验、候选树关键字保护和写入载荷；不替代真实部署验证。',
  },
  {
    source: 'test/finance-setting-cat-map.test.ts',
    kind: 'test',
    note: '离线替身锁定页面请求契约、树候选投影、字段空值/ID命名空间、POST/PUT body键序和取消路径；不等于浏览器或真实写入证据。',
  },
]

const gaps = [
  '没有独立浏览器基准：列表默认请求、候选树返回量、真实序列化键序和按钮权限目前都是固定检出源码推断，不能标为页面实测。',
  '没有真实SDK读冒烟或写冒烟；create/update/discard均未向测试环境发送，返回ID/true与列表核对闭环未验证。',
  '两份固定Portal/Java检出工作区干净但本轮未能执行pull --ff-only；若线上版本不同，应以新的源码与浏览器基准重新核对路径和字段。',
]

const boundaries = [
  '只覆盖菜单路径/dashboard/finance/setting/cat-map/list及其创建/编辑表单，不覆盖财务类目维护、资产类目维护或其他finance页面。',
  '所有请求使用platform HTTP实例；页面无法推导module-type，SDK显式不发送该头。请求仍由一个绑定当前用户与租户的会话实例发出。',
  '类目对照page端点名称含page但后端返回全量数组并忽略分页筛选；list不接受pageNo/pageSize，也不把数组伪造成{list,total}。',
  '候选接口是页面树组件的真实入口；后端不按关键字分页，SDK要求非空keyword后拉树并在本地最多返回limit项，以免把整棵长树直接冲入上下文。候选空数组只表示本次关键字无匹配。',
  'financeCategoryId、thingCategoryIds属于不同ID命名空间；资产树isUse=1的节点在页面被禁用，不能把禁用候选当成可提交值。',
  '页面隐藏status在创建/编辑请求中固定为true；discard才发送status=false。status不是一个对外可切换的数值状态字段。',
  '编辑请求保留原current.id；当用户换了财务类目时只改变financeCategoryId，后端会解绑旧财务类目、绑定新财务类目，不能把id改成新ID。',
  '页面没有get、restore、delete或导出按钮。废弃没有后端恢复接口；恢复只能在保留原值并经用户确认后用create重新绑定，可能受候选状态和并发变化影响。',
]

const failures = [
  '参数或响应形状不符合契约时SDK在发请求前或收到响应后抛错，不把错误改写成空树、空列表或成功；修正输入或重新核对部署契约。',
  '401/403、网络和后端业务错误原样抛出；不能把无权限、候选无匹配与空数据混为一谈。',
  '写请求超时或断网时结果不确定：先list核对原ID、目标财务类目和资产ID；未核实前不要用相同意图盲目重发。',
  'create/update/discard没有后端请求幂等键；同一意图重试可能重复关系、覆盖并发编辑或再次废弃，必须串行并保留核对前快照。',
]

function contract (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'> & Partial<Pick<AiContract, 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>>): AiContract {
  return {
    whenToUse: '操作门户系统“财务设置→类目对照表”PC页面；不用于独立财务类目/资产类目维护或其他映射页面。',
    boundaries,
    prerequisites: [
      '已建立带有效会话token、tenantId和platform baseUrl的SDK；账号须有本页权限及对应create/edit/delete按钮权限。',
      '写入前必须从候选树或最新列表取得真实ID并由用户确认，不能使用名称、数组下标或示例ID。',
    ],
    failures,
    evidence,
    gaps,
    ...value,
  }
}

export const FINANCE_SETTING_CAT_MAP_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-cat-map-finance-category-search': contract({
    purpose: '按财务类目名称关键字搜索创建/编辑表单的财务类目树候选，返回可提交的财务类目ID与完整路径。',
    effect: 'read',
    inputs: candidateInputs,
    output: {
      shape: '{ list: FinanceSettingCatMapFinanceCategoryOption[], matched: number }',
      fields: [
        field('$', 'object', 'SDK候选查询结果'),
        field('list', 'array', '最多limit个名称匹配候选；不是后端分页页'),
        field('list[]', 'object', '一个财务类目候选'),
        field('list[].id', 'string | number', '财务类目主键；填入prepare-create/create的financeCategoryId'),
        field('list[].name', 'string', '当前树节点名称'),
        field('list[].path', 'string', '从树根到当前节点的名称路径，用“》》”区分同名层级'),
        field('matched', 'integer', '本次实际返回的候选数；SDK已按limit截断，不能解释为后端全量匹配总数'),
      ],
      empty: 'list=[]且matched=0表示整棵页面树中没有名称包含keyword的节点；权限/网络失败抛错。',
    },
    consume: ['展示path让用户消歧并保留选中list[].id；不要传name或数组下标。', 'keyword没有匹配时换名称片段；不要把空数组当作网络成功或财务类目不存在的全局证明。'],
    steps: [{ role: 'optional', when: '财务类目已选定且还需收集资产类目后准备保存', capabilityId: 'finance-setting-cat-map-prepare-create', mapping: { financeCategoryId: 'result.list[].id' }, instruction: '只把用户确认的一个财务类目ID与资产候选选中的thingCategoryIds一起传入prepareCreate。' }],
    completion: '已交付关键字命中的财务类目候选，或明确本次树内无匹配；没有写入映射。',
    idempotency: null,
  }),

  'finance-setting-cat-map-thing-category-search': contract({
    purpose: '按资产类目名称关键字搜索创建/编辑表单的资产类目树候选，返回路径、占用状态和页面是否允许选择。',
    effect: 'read',
    inputs: candidateInputs,
    output: {
      shape: '{ list: FinanceSettingCatMapThingCategoryOption[], matched: number }',
      fields: [
        field('$', 'object', 'SDK候选查询结果'),
        field('list', 'array', '最多limit个名称匹配候选；不是后端分页页'),
        field('list[]', 'object', '一个资产类目候选'),
        field('list[].id', 'string | number', '资产类目主键；填入prepare-create/create的thingCategoryIds数组'),
        field('list[].name', 'string', '当前树节点名称'),
        field('list[].path', 'string', '从树根到当前节点的名称路径，用“》》”区分同名层级'),
        field('list[].isUse', 'integer', '页面树的占用/禁用标志；0表示页面未禁用，1表示页面禁用', { values: { '0': '可选择', '1': '页面禁用' } }),
        field('list[].selectable', 'boolean', 'SDK按页面disabled=!!isUse归一出的可提交提示；只有true才应被用户选择'),
        field('matched', 'integer', '本次实际返回的候选数；SDK已按limit截断，不能解释为后端全量匹配总数'),
      ],
      empty: 'list=[]且matched=0表示整棵页面树中没有名称包含keyword的节点；权限/网络失败抛错。',
    },
    consume: ['展示path让用户消歧；只收集selectable=true的list[].id，可一次选择多个。', 'selectable=false的节点虽然返回用于解释页面树状态，但不能提交；若需要其它资产类目应换keyword。'],
    steps: [{ role: 'optional', when: '资产类目已选定且还需财务类目后准备保存', capabilityId: 'finance-setting-cat-map-prepare-create', mapping: { thingCategoryIds: 'result.list[].id' }, instruction: '只把用户确认的selectable候选ID数组与财务类目ID一起传入prepareCreate；不要把禁用节点混入数组。' }],
    completion: '已交付关键字命中的资产类目候选及可选状态，或明确本次树内无匹配；没有写入映射。',
    idempotency: null,
  }),

  'finance-setting-cat-map-list': contract({
    purpose: '读取PC类目对照表的全部已绑定财务类目行，供展示、编辑、废弃和写入结果核对。',
    effect: 'read',
    inputs: {},
    output: {
      shape: 'FinanceSettingCatMapRow[]',
      fields: [field('$', 'array', '全部已绑定财务类目行；不是分页对象'), field('[]', 'object', '一条页面表格行'), ...rowFields('[]')],
      empty: '[]表示当前会话权限范围内没有已绑定类目对照；网络/权限失败不会返回空数组。',
    },
    consume: ['展示financeCategoryName、thingCategoryName与bindTime；保留id、financeCategoryId、thingCategoryIds整行快照。', '编辑或废弃前重新list，不能用行号、名称或旧快照猜ID。'],
    steps: [
      { role: 'optional', when: '用户要编辑某一行', capabilityId: 'finance-setting-cat-map-prepare-update', mapping: { current: 'result.[]' }, instruction: '只传用户选中的一条完整行；changes只放用户明确修改的financeCategoryId或thingCategoryIds。' },
      { role: 'optional', when: '用户确认废弃某一行', capabilityId: 'finance-setting-cat-map-discard', mapping: { id: 'result.[].id', financeCategoryId: 'result.[].financeCategoryId', thingCategoryIds: 'result.[].thingCategoryIds' }, instruction: '保留同一行的三个值；先取得用户确认再发送废弃写请求。' },
    ],
    completion: '已交付当前全量绑定映射快照；没有创建、编辑或废弃。',
    idempotency: null,
  }),

  'finance-setting-cat-map-prepare-create': contract({
    purpose: '校验创建表单的两个类目ID并生成与Portal POST完全同键序的草稿，不写入。',
    effect: 'prepare',
    inputs: createInputs,
    output: {
      shape: '{ draft: FinanceSettingCatMapSaveDraft }',
      fields: [field('$', 'object', '只读创建准备结果'), field('draft', 'object', '可供create重新校验的完整表单草稿'), ...saveFields('draft')],
      empty: 'financeCategoryId非法、thingCategoryIds为空或含非法ID会抛错；不会返回半成品草稿。',
    },
    consume: ['向用户展示将绑定的财务ID、资产ID数组，并确认draft.status=true与draft.id=""是页面固定隐藏值。', 'prepare不发HTTP、不锁定类目、不证明后端允许创建；草稿或候选变化后必须重新prepare。'],
    steps: [{ role: 'required', when: '用户确认草稿并要求实际创建', capabilityId: 'finance-setting-cat-map-create', mapping: { financeCategoryId: 'result.draft.financeCategoryId', thingCategoryIds: 'result.draft.thingCategoryIds' }, instruction: '把两个业务输入传给create；不要把draft整体当成invoke参数，也不要自行改写status/id。' }],
    completion: '已得到可审阅的创建草稿；尚未绑定任何类目。',
    idempotency: null,
  }),

  'finance-setting-cat-map-create': contract({
    purpose: '按页面创建表单把一个财务类目与至少一个资产类目建立映射，返回后端返回的财务类目主键。',
    effect: 'write',
    inputs: createInputs,
    output: {
      shape: 'string | number',
      fields: [field('$', 'string | number', '后端create返回的财务类目主键；通常等于args.financeCategoryId，可用于后续list定位')],
      empty: '响应不是安全正ID会抛错；根ID本身不等于关系已独立核对。',
    },
    consume: ['保存返回ID和原始thingCategoryIds；随后list并按返回ID定位唯一行，核对financeCategoryId与完整thingCategoryIds。', 'create是新增/重新绑定，不是编辑已有行；重复意图先查列表，不要直接重发。'],
    steps: [
      { role: 'required', when: 'create返回成功或超时，需要确认写入终态', capabilityId: 'finance-setting-cat-map-list', instruction: '查全量列表并定位result.$对应的financeCategoryId；核对目标资产ID数组。找不到或出现冲突时保持结果不确定，不自动重建。' },
      { role: 'cancel', when: '创建已由list核实且用户明确要求清理本次新映射', capabilityId: 'finance-setting-cat-map-discard', mapping: { id: 'result.$', financeCategoryId: 'result.$', thingCategoryIds: 'args.thingCategoryIds' }, instruction: 'discard是页面现有的废弃动作，不是后端事务回滚；执行前确认返回ID仍对应本次创建，之后再次list确认行消失。' },
    ],
    completion: '只有list独立找到返回ID并核对财务/资产ID后才报告创建已验证；若用户未要求清理，不能自动调用discard。',
    idempotency: '后端没有请求幂等键；SDK不缓存写结果。成功或超时后必须先list核实，同一意图未核实前不得盲目重发；已核实创建的清理只能由用户明确要求后调用discard。',
  }),

  'finance-setting-cat-map-prepare-update': contract({
    purpose: '以最新列表行作为编辑前快照，只合并允许修改的财务类目或资产类目数组，并生成完整PUT草稿与恢复所需旧值；不写入。',
    effect: 'prepare',
    inputs: updateInputs,
    output: {
      shape: '{ draft: FinanceSettingCatMapSaveDraft, previous: FinanceSettingCatMapSaveDraft }',
      fields: [field('$', 'object', '只读编辑准备结果'), field('draft', 'object', '合并后的完整PUT草稿'), ...saveFields('draft'), field('previous', 'object', 'prepare时的旧值快照；不是服务端版本锁'), ...saveFields('previous')],
      empty: 'current缺少完整ID/数组或changes含非法值会抛错；不会返回可部分提交的草稿。',
    },
    consume: ['确认draft.id仍是原绑定ID；如果更换财务类目，只改变draft.financeCategoryId，不能改draft.id。', '保留previous用于用户明确要求恢复；prepare不锁定记录，提交前若数据可能并发变化应重新list和prepare。'],
    steps: [
      { role: 'required', when: '用户确认保存此次编辑', capabilityId: 'finance-setting-cat-map-update', mapping: { current: 'result.draft', changes: 'literal:{}' }, instruction: '把完整draft作为current并传空changes；update会再次校验并按页面键序发送PUT。' },
      { role: 'cancel', when: '此次编辑已保存、用户明确要求恢复且确认没有要保留的并发修改', capabilityId: 'finance-setting-cat-map-update', mapping: { current: 'result.draft', 'changes.financeCategoryId': 'result.previous.financeCategoryId', 'changes.thingCategoryIds': 'result.previous.thingCategoryIds' }, instruction: '恢复是再次PUT而不是服务端回滚；恢复后必须list核对旧财务ID和旧资产ID数组。' },
    ],
    completion: '已形成完整编辑草稿和旧值快照；尚未更新映射。',
    idempotency: null,
  }),

  'finance-setting-cat-map-update': contract({
    purpose: '把现有类目对照替换为用户确认的财务类目和/或完整资产类目数组；保持原绑定ID字段以复刻Portal编辑请求。',
    effect: 'write',
    inputs: updateInputs,
    output: {
      shape: 'boolean',
      fields: [field('$', 'boolean', '后端CommonResult<Boolean>解包后的成功值；必须严格为true，不含更新后行')],
      empty: '响应不是true会抛错；true只表示后端接受更新，不替代list核对。',
    },
    consume: ['请求body为{thingCategoryIds, financeCategoryId, status:true, id}；id取编辑前current.id，financeCategoryId取目标值。', '成功或超时后list定位原ID或目标financeCategoryId，核对后端实际保留的绑定；换财务类目时旧ID可能不再出现在列表。'],
    steps: [
      { role: 'required', when: '更新返回true或超时，需要确认终态', capabilityId: 'finance-setting-cat-map-list', instruction: '刷新全量列表；未更换财务类目时定位args.current.id，更换时同时核对目标financeCategoryId及资产数组，不能按名称第一条判断。' },
      { role: 'cancel', when: '本次更新已核实且用户明确要求恢复，且args.current仍是更新前快照', capabilityId: 'finance-setting-cat-map-update', mapping: { current: 'args.current' }, instruction: '不传changes表示恢复args.current的完整财务/资产值；这是第二次PUT，执行前要确认没有并发修改，之后仍需list。' },
    ],
    completion: '只有list核对更新后的ID关系和资产数组后才报告编辑已验证；true本身不是独立写入证据。',
    idempotency: '后端无请求幂等键，update按原id删除旧关系后重建目标关系。成功或超时必须先list核实；恢复也是一次新的update，不要并发发送正向与恢复请求。',
  }),

  'finance-setting-cat-map-discard': contract({
    purpose: '执行页面“废弃”动作：把指定财务类目标记为未绑定并清除其资产关系。',
    effect: 'write',
    inputs: discardInputs,
    output: {
      shape: 'boolean',
      fields: [field('$', 'boolean', '后端CommonResult<Boolean>解包后的成功值；必须严格为true，不含被废弃行')],
      empty: '响应不是true会抛错；true只表示请求成功返回，必须list确认行已消失。',
    },
    consume: ['body键序为{id, status:false, thingCategoryIds, financeCategoryId}；三个业务ID/数组必须来自同一条最新列表行。', '成功或超时后list确认原financeCategoryId不再作为已绑定行出现；不要只看message.success或true。'],
    steps: [
      { role: 'required', when: '废弃返回true或超时，需要确认清理结果', capabilityId: 'finance-setting-cat-map-list', instruction: '刷新列表并按args.id查找；同一ID仍出现时结果不确定，不自动重复废弃。' },
      { role: 'cancel', when: '用户明确要求恢复且仍有原financeCategoryId与thingCategoryIds快照', capabilityId: 'finance-setting-cat-map-create', mapping: { financeCategoryId: 'args.financeCategoryId', thingCategoryIds: 'args.thingCategoryIds' }, instruction: '后端没有restore接口；create重新建立关系是补偿动作，不是原事务回滚。创建后必须list核对，并先确认财务类目当前仍可绑定且没有并发新映射。' },
    ],
    completion: '只有list确认原绑定行消失才报告废弃已验证；该页面没有独立恢复按钮。',
    idempotency: '后端无请求幂等键；discard会更新财务类目绑定标志并删除关系。成功或超时先list核实，恢复只能在用户明确要求时用保存的旧值重新create。',
  }),
}

export const FINANCE_SETTING_CAT_MAP_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_CAT_MAP_METHODS).map(([capabilityId, method]) => {
    const source = FINANCE_SETTING_CAT_MAP_AI_CONTRACTS[capabilityId]!
    return [`financeSettingCatMap.${method}`, {
      ...source,
      boundaries: [
        ...source.boundaries,
        `公开方法financeSettingCatMap.${method}(input)接收单个对象参数；字段与inputs一致，list可省略input。能力invoke同样使用对象参数。`,
      ],
    }]
  }),
)
