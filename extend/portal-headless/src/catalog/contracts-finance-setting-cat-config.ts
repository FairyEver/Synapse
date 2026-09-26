import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_CAT_CONFIG_METHODS } from '../capabilities/finance-setting-cat-config.js'

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

const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, {
  required: false,
  omitted,
  ...extra,
})

const statusOptions = [
  { value: 0, label: '停用' },
  { value: 1, label: '启用' },
]

const categoryTypeOptions = [
  { value: 1, label: '主营业务收入' },
  { value: 3, label: '补贴收入' },
  { value: 4, label: '其他收入' },
]

const id = input(
  '类目配置主键ID；不是父类目ID、类别字典值或租户ID。长ID必须保留字符串。',
  'finance-setting-cat-config-list结果中选中树节点的id，或create返回值',
  { type: 'string | number', constraints: ['安全正整数或无前导零的正整数字符串'] },
)

const pid = optional(
  '上级类目主键ID；顶级类目没有父级。',
  'finance-setting-cat-config-list结果中父节点的id',
  '创建顶级类目时由SDK发送空字符串；不能把类目名称当成ID',
  { type: 'string | number', constraints: ['子类目必须使用最新树节点id；顶级可省略、传null或空字符串'] },
)

const categoryName = input(
  '类目名称；页面仅要求必填，SDK拒绝去首尾空白后为空的值，但保留原字符串发送。',
  '用户输入或编辑前的最新列表行categoryName',
  { type: 'string', constraints: ['去首尾空白后非空；不要传父类目名称'] },
)

const categoryType = optional(
  '类目类别字典值；发送数值，不是标签文字或字典条目ID。',
  '用户选择的运行时category_type字典value；缺省沿用页面表单默认值1',
  'SDK发送数值1；前端字典实际候选以部署运行时为准',
  { type: 'integer', default: '数值1', options: categoryTypeOptions, constraints: ['安全整数；不因未列入源码枚举的部署扩展值而自动改写'] },
)

const row = input(
  '来自最新类目配置树的完整行对象；detail只读取其桥接字段，不发GET。',
  'finance-setting-cat-config-list结果中的result[]或result[].children[]',
  { type: 'object' },
)

const current = input(
  '来自最新启用树的完整行对象，或此前保存的完整草稿；必须包含id、status、categoryName、categoryType和pid。',
  'finance-setting-cat-config-list结果中的选中树节点，或prepare结果的previous',
  { type: 'object' },
)

const changes = optional(
  '编辑变更对象；只允许pid、categoryName、categoryType，未给出的字段沿用current。',
  '用户确认的编辑差异',
  '不改变对应业务字段',
  { type: 'object' },
)

const draft = input(
  'prepareUpdate或prepareDiscard返回的完整保存草稿；不要手写或删掉status、id、pid、categoryName、categoryType。',
  '上一步prepare结果中的draft',
  { type: 'object' },
)

const rowFields = (prefix: string): AiField[] => [
  field(`${prefix}.id`, 'string | number', '类目配置主键ID；新建子类目和编辑父级使用此值'),
  field(`${prefix}.status`, 'integer', '后端状态；列表查询只返回1，废弃提交将其设为0', { values: { '0': '停用/废弃', '1': '启用/列表可见' } }),
  field(`${prefix}.createTime`, 'string | number', '后端录入时间原值；页面只格式化显示，SDK不猜时区', { nullable: true, nullMeaning: '后端没有录入时间' }),
  field(`${prefix}.categoryName`, 'string', '类目名称'),
  field(`${prefix}.categoryType`, 'integer', '类目类别category_type字典value；已知后端枚举为1、3、4，部署字典扩展值保留原数值'),
  field(`${prefix}.pid`, 'string | number', '父类目主键ID；后端根标识0或"0"由SDK归一为null', { nullable: true, nullMeaning: '顶级类目' }),
  field(`${prefix}.parentId`, 'string | number', 'pid的响应别名；SDK按后端返回值归一，通常与pid相同', { nullable: true, nullMeaning: '顶级类目' }),
  field(`${prefix}.children`, 'array', '直接下级类目；每个子节点递归具有同样业务字段'),
  field(`${prefix}.children[]`, 'object', '一个直接下级节点'),
  field(`${prefix}.children[].id`, 'string | number', '下级节点主键ID'),
  field(`${prefix}.children[].status`, 'integer', '下级节点状态；列表结果通常为1', { values: { '0': '停用/废弃', '1': '启用/列表可见' } }),
  field(`${prefix}.children[].createTime`, 'string | number', '下级节点录入时间原值', { nullable: true, nullMeaning: '后端没有录入时间' }),
  field(`${prefix}.children[].categoryName`, 'string', '下级节点名称'),
  field(`${prefix}.children[].categoryType`, 'integer', '下级节点类别字典value'),
  field(`${prefix}.children[].pid`, 'string | number', '下级节点父类目ID', { nullable: true, nullMeaning: '该节点是树根' }),
  field(`${prefix}.children[].parentId`, 'string | number', '下级节点父类目ID响应别名', { nullable: true, nullMeaning: '该节点是树根' }),
  field(`${prefix}.children[].children`, 'array', '下级节点的下下级数组；递归结构与当前节点相同'),
]

const treeOutputFields: AiField[] = [
  field('$', 'array', '后端返回的根节点数组；不是{list,total}分页对象'),
  field('[]', 'object', '一个根类目节点；children递归同构'),
  ...rowFields('[]'),
]

const detailFields: AiField[] = [
  field('$', 'object', '当前详情桥接快照'),
  field('id', 'string | number', '类目配置主键ID'),
  field('pName', 'string', '详情页桥接的父类目名称；列表动作未提供时为空，页面显示“顶级”', { nullable: true, nullMeaning: '没有pName桥接值；详情页不主动查父级名称' }),
  field('pid', 'string | number', '父类目ID；根标识统一为null', { nullable: true, nullMeaning: '顶级类目' }),
  field('categoryName', 'string', '类目名称'),
  field('categoryType', 'integer', '类目类别字典value'),
]

const createDraftFields: AiField[] = [
  field('$', 'object', '尚未写入的创建草稿'),
  field('draft', 'object', '发送给create的后端业务字段子集；不含pName、id、pList等桥接字段'),
  field('draft.pid', 'string | number', '父类目ID；顶级为Portal原样空字符串', { nullable: false }),
  field('draft.categoryName', 'string', '类目名称'),
  field('draft.categoryType', 'integer', '类目类别数值；默认1'),
]

const saveDraftFields = (prefix: string): AiField[] => [
  field(prefix, 'object', '完整保存草稿'),
  field(`${prefix}.id`, 'string | number', '类目配置主键ID'),
  field(`${prefix}.status`, 'integer', '本次保存的绝对状态；0停用、1启用', { values: { '0': '停用/废弃', '1': '启用' } }),
  field(`${prefix}.categoryName`, 'string', '类目名称'),
  field(`${prefix}.categoryType`, 'integer', '类目类别数值'),
  field(`${prefix}.pid`, 'string | number', '父类目ID；顶级为空字符串', { nullable: false }),
]

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc76c app/portal/views/dashboard/finance/setting/cat-config/list.vue',
    kind: 'reference',
    note: '证明列表GET路径与空表单参数、树转换、创建/编辑/废弃/查看按钮、四个权限码、废弃确认文字及本地桥接详情；不是浏览器网络实测。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc76c app/portal/views/dashboard/finance/setting/cat-config/[mode]/[id].vue 与 detail/[id].vue',
    kind: 'reference',
    note: '证明表单字段、pid顶级空字符串、categoryType默认1、创建POST/编辑PUT、UI桥接字段pName/pList/id及详情无GET；不是浏览器网络实测。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 IncomeCategoryController/ServiceImpl/Mapper及VO',
    kind: 'reference',
    note: '证明page返回树数组且只查status=1、create返回Long、update返回true、废弃校验绑定与启用子节点、后端没有DELETE接口；不是部署环境实测。',
  },
  {
    source: 'src/capabilities/finance-setting-cat-config.ts',
    kind: 'implementation',
    note: '证明SDK字段投影、请求体键序、父级归一、prepare草稿和无浏览器凭据处理；不替代真实Portal验证。',
  },
  {
    source: 'test/finance-setting-cat-config.test.ts',
    kind: 'test',
    note: '离线夹具锁定请求、树返回、桥接详情、三类写入草稿与AI结构；不等于浏览器或真实环境读写闭环。',
  },
]

const gaps = [
  '本次按任务要求未启动浏览器，因此没有GET/POST/PUT网络基准；请求键序和空值行为是Portal源码推导加离线测试，不是浏览器抓包结论。',
  '没有真实测试环境读或写smoke；尤其未执行创建、编辑、废弃。创建没有DELETE接口，无法为新建记录提供可逆清理闭环，不能安全宣称写入已验证。',
  '创建表单不发送status，数据库默认状态及创建后是否一定进入status=1列表未在当前源码范围外验证；SDK不擅自补status。',
  'category_type前端标签来自运行时字典；1、3、4来自Java IncomeCategoryEnum源码，部署字典的实际标签和扩展值未独立观测。',
  '详情页从列表直接桥接record且列表行没有pName；子类目详情的父级名称显示行为存在源码层面的缺口，SDK保留缺失pName而不伪造父名。',
]

const boundaries = [
  '能力只覆盖菜单“财务设置→类目配置”页面；使用platform HTTP实例，当前页面catalog moduleType为null，调用时不发送module-type头，tenant-id仍由绑定会话负责。',
  '列表无真实筛选控件、无分页器，Portal只发送order=""和orderField=""，后端固定返回启用类目的完整树数组；SDK不接受pageNo、pageSize或注释掉的筛选字段。',
  '页面按钮权限为finance:setting:cat-config:create、edit、delete、detail；能力permission绑定菜单权限/dashboard/finance/setting/cat-config，按钮权限由调用方账号承担。',
  '列表的topIndex是Portal客户端为编辑父级选择计算的临时字段，不属于后端响应；pName和pList是表单桥接字段，create/update只发送后端VO字段。',
  '“废弃”不是删除：页面调用PUT /admin-api/finance/income-category/update并将status绝对设为0；后端没有DELETE，且绑定类目或存在启用子节点时会拒绝。',
  '详情动作不调用后端get；需要最新字段或状态时必须先list，再把同一树节点快照传给detail或prepare动作。',
  'categoryType的运行时标签不由本页能力硬编码；契约仅引用Java源码已知的1/3/4，未知整数按原值传递，不能把字典条目ID或标签文字代替value。',
]

function contract (
  value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'> & Partial<Pick<AiContract, 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>>,
): AiContract {
  return {
    whenToUse: '操作门户系统“财务设置→类目配置”PC页面；不用于收入类目对照表、其它类目候选接口或后台直接查询。',
    boundaries,
    prerequisites: [
      '已建立带有效会话token与tenantId的SDK；一个platform HTTP实例只绑定一个用户和租户。',
      '写入前必须取得当前树节点快照，并由账号具备页面权限和对应按钮权限。',
    ],
    failures: [
      '参数或响应形状校验失败时不会伪造空树、成功布尔值或ID；修正参数或核对部署契约后再调用。',
      '401/403、网络错误或后端业务错误原样抛出；读请求失败不能改写为空数组，写请求失败不能改写为成功。',
      '类目名称重复、父级被绑定、废弃类目被绑定或存在启用子节点时，后端会拒绝；保留原错误并刷新最新树，不盲目重复。',
      '写请求超时或断网时结果不确定：创建先按名称/父级/类别刷新树核对，编辑按ID核对；废弃因列表只返回启用行，需依赖保存的previous草稿做补偿恢复，不能用缺席当作成功证明。',
    ],
    evidence,
    gaps,
    ...value,
  }
}

const createInputs: Record<string, AiParameter> = { pid, categoryName, categoryType }

export const FINANCE_SETTING_CAT_CONFIG_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-setting-cat-config-list': contract({
    purpose: '读取当前用户/租户可见的启用收入类目完整树，取得详情、创建子类目、编辑父级和废弃所需的真实节点ID与业务字段。',
    effect: 'read',
    inputs: {},
    output: {
      shape: 'FinanceSettingCatConfigRow[]',
      fields: treeOutputFields,
      empty: '[]表示当前权限和租户范围内没有启用根类目；网络、权限或业务错误会抛出，不会转换成空数组。',
    },
    consume: [
      '递归遍历[]和children；用id作为后续pid、编辑和废弃目标，不要把categoryName当ID。',
      '把categoryType交给运行时category_type字典解释；status=1表示列表可见/启用，0表示停用或废弃。',
      '从一行保存完整的id、status、categoryName、categoryType、pid作为后续prepare草稿输入；不要只保存名称。',
    ],
    steps: [
      { role: 'optional', when: '用户要查看某个树节点', capabilityId: 'finance-setting-cat-config-detail', mapping: { row: 'result.[]' }, instruction: 'result.[]可来自根或任意children层；detail只使用列表桥接快照。' },
      { role: 'optional', when: '用户要创建顶级或子类目', capabilityId: 'finance-setting-cat-config-prepare-create', mapping: { pid: 'result.[].id' }, instruction: '子类目把选中父节点id映射为pid；顶级创建省略pid；另向用户收集categoryName并确认categoryType。' },
      { role: 'optional', when: '用户要编辑节点名称、类别或父级', capabilityId: 'finance-setting-cat-config-prepare-update', mapping: { current: 'result.[]' }, instruction: 'result.[]可来自任意树层；changes只填用户明确要修改的pid、categoryName或categoryType。' },
      { role: 'optional', when: '用户要废弃启用节点', capabilityId: 'finance-setting-cat-config-prepare-discard', mapping: { current: 'result.[]' }, instruction: '只对最新status=1节点准备；保留prepare返回的previous以便需要时补偿恢复。' },
    ],
    completion: '交付完整启用树和可用于下一步的节点快照；根节点数量不等于全部节点数量，必须递归处理children。',
    idempotency: null,
  }),

  'finance-setting-cat-config-detail': contract({
    purpose: '按列表行桥接快照展示类目配置详情，不额外请求后端get。',
    effect: 'local',
    inputs: { row },
    output: {
      shape: 'FinanceSettingCatConfigDetail',
      fields: detailFields,
      empty: '输入缺少有效id、categoryName或categoryType时抛错；不返回不完整详情。',
    },
    consume: [
      '用categoryType调用运行时字典标签；pName为null时页面显示“顶级”。',
      '这是进入详情时的本地快照，不代表此刻后端最新status；需要新鲜数据时先重新list。',
    ],
    steps: [],
    completion: '已交付页面详情字段；没有发生网络请求。',
    idempotency: null,
  }),

  'finance-setting-cat-config-prepare-create': contract({
    purpose: '校验创建类目配置的父级、名称和类别，并生成不写入的创建草稿。',
    effect: 'prepare',
    inputs: createInputs,
    output: {
      shape: '{ draft: FinanceSettingCatConfigCreatePayload }',
      fields: createDraftFields,
      empty: '输入不合法会抛错；不会返回半成品draft。',
    },
    consume: [
      '向用户展示父类目、名称和类别，确认这是新增而不是编辑；draft.pid为空字符串时表示顶级。',
      '不要把pName、id或pList自行加入draft；它们是Portal桥接字段，不是SDK创建载荷。',
    ],
    steps: [{
      role: 'required',
      when: '用户确认草稿后执行创建',
      capabilityId: 'finance-setting-cat-config-create',
      mapping: { pid: 'result.draft.pid', categoryName: 'result.draft.categoryName', categoryType: 'result.draft.categoryType' },
      instruction: '只把prepare返回的三个业务字段交给create；不要修改draft后声称仍是同一预览。',
    }],
    completion: '只完成本地校验和请求预览，尚未写入记录。',
    idempotency: null,
  }),

  'finance-setting-cat-config-create': contract({
    purpose: '按页面创建表单新增一个顶级或指定父级的收入类目配置，并返回后端分配的主键ID。',
    effect: 'write',
    inputs: createInputs,
    output: {
      shape: 'string | number',
      fields: [field('$', 'string | number', '新建类目配置主键ID；不是类别字典value或父级ID')],
      empty: '成功必须返回安全正ID；缺失或非法ID会抛错，不能当成创建成功。',
    },
    consume: [
      '保存返回ID；用同一父级、名称和类别重新list，递归寻找该ID并核对字段。',
      'create只发送pid、categoryName、categoryType，省略页面桥接字段pName、id、pList；创建status未由页面显式发送。',
    ],
    steps: [
      { role: 'required', when: '创建返回ID或写请求超时，需要独立确认最终状态', capabilityId: 'finance-setting-cat-config-list', instruction: '刷新完整启用树，递归按result.$查找同一ID并核对父级、名称、类别；找不到时结果仍不确定。' },
      { role: 'cancel', when: '用户要求撤销已创建记录', instruction: 'Portal页面和后端当前都没有删除或可逆创建接口；不要伪造cancel成功。若必须清理，需使用部署方受控数据库/运维清理证据，当前任务未执行。' },
    ],
    completion: '仅当返回ID且刷新树读回同一ID及预期字段后，才能报告创建已核实；本能力本身不提供可逆撤销。',
    idempotency: '后端没有幂等键，SDK也不替页面生成幂等键；重复调用可能新增重复记录或被“类目名称重复”拒绝。超时先list按父级/名称/类别核对，未核实前不要重建；创建清理需要外部受控方案。',
  }),

  'finance-setting-cat-config-prepare-update': contract({
    purpose: '基于最新树节点快照合并名称、类别或父级变更，生成完整编辑草稿，不写入。',
    effect: 'prepare',
    inputs: { current, changes },
    output: {
      shape: '{ draft: FinanceSettingCatConfigSaveDraft, previous: FinanceSettingCatConfigSaveDraft }',
      fields: [
        field('$', 'object', '编辑准备结果'),
        ...saveDraftFields('draft'),
        ...saveDraftFields('previous'),
      ],
      empty: '当前值或变更不合法会抛错；不会返回半成品draft。',
    },
    consume: ['向用户展示draft与previous的差异；draft保留原status，编辑页面没有状态编辑控件。', '确认父级变更使用真实节点id，而不是pName。'],
    steps: [{
      role: 'required',
      when: '用户确认编辑草稿后执行更新',
      capabilityId: 'finance-setting-cat-config-update',
      mapping: { draft: 'result.draft' },
      instruction: '把prepare返回的完整draft交给update；若用户改变任一字段，应重新prepare而不是手改旧草稿。',
    }],
    completion: '只完成本地合并和校验，尚未写入记录。',
    idempotency: null,
  }),

  'finance-setting-cat-config-update': contract({
    purpose: '提交一个已准备的完整类目配置编辑草稿，更新名称、类别或父级结构。',
    effect: 'write',
    inputs: { draft },
    output: {
      shape: 'boolean',
      fields: [field('$', 'boolean', '后端update成功标志；成功为true，不含更新后的记录')],
      empty: '后端未返回true或请求失败时抛错。',
    },
    consume: ['true只证明后端接受了PUT；随后list并按draft.id核对名称、类别、pid和status。', '保留prepare返回的previous草稿，发生误改且用户明确要求恢复时才能执行补偿更新。'],
    steps: [
      { role: 'required', when: '更新返回true或超时，需要确认终态', capabilityId: 'finance-setting-cat-config-list', instruction: '刷新启用树并递归查找draft.id；找到后核对draft.categoryName、draft.categoryType、draft.pid和draft.status。' },
      { role: 'cancel', when: '用户明确要求撤销本次已核实编辑且仍保存着操作前previous草稿', capabilityId: 'finance-setting-cat-config-update', mapping: { draft: 'context.previousDraft' }, instruction: '用prepareUpdate返回的previous作为新的完整draft再次PUT；这是补偿写，不是事务回滚，之后仍需list核对。' },
    ],
    completion: '只有列表读回draft.id且全部业务字段一致才报告编辑已核实；true本身不包含新记录。',
    idempotency: '后端没有版本号或幂等键；重复同一完整draft通常目标状态相同，但可能更新时间变化，且并发写会覆盖字段。超时先list核对，未核实前不要重复发送或覆盖最新编辑。',
  }),

  'finance-setting-cat-config-prepare-discard': contract({
    purpose: '校验一个最新启用类目节点并生成status=0的废弃草稿，不写入。',
    effect: 'prepare',
    inputs: { current },
    output: {
      shape: '{ draft: FinanceSettingCatConfigSaveDraft, previous: FinanceSettingCatConfigSaveDraft }',
      fields: [
        field('$', 'object', '废弃准备结果'),
        ...saveDraftFields('draft'),
        ...saveDraftFields('previous'),
      ],
      empty: '当前节点不是status=1或字段不完整时抛错；不会返回半成品draft。',
    },
    consume: ['向用户明确展示废弃会让该类目及关联数据无法正常显示；保留previous以便必要时补偿恢复。', '不要只传id废弃，后端更新需要完整categoryName、categoryType和pid。'],
    steps: [{
      role: 'required',
      when: '用户确认废弃草稿后执行更新',
      capabilityId: 'finance-setting-cat-config-discard',
      mapping: { draft: 'result.draft' },
      instruction: '把status=0的完整draft交给discard；discard仍调用后端update，不是DELETE。',
    }],
    completion: '只完成本地校验和status=0预览，尚未改变后端状态。',
    idempotency: null,
  }),

  'finance-setting-cat-config-discard': contract({
    purpose: '按页面“废弃”动作将一个启用类目设置为status=0；后端会拒绝被绑定或有启用子节点的类目。',
    effect: 'write',
    inputs: { draft },
    output: {
      shape: 'boolean',
      fields: [field('$', 'boolean', '后端update成功标志；成功为true，不含废弃后的记录')],
      empty: '后端未返回true或请求失败时抛错。',
    },
    consume: ['true只证明PUT完成；刷新启用树并确认draft.id不再出现在结果中，同时保留previous快照。', '列表只返回status=1，找不到被废弃ID是预期的可见性变化，不是单独的后端删除证明。'],
    steps: [
      { role: 'required', when: '废弃返回true或超时，需要确认启用列表终态', capabilityId: 'finance-setting-cat-config-list', instruction: '刷新启用树并确认draft.id不在树中；若仍存在，读取最新行并停止后续重复写。' },
      { role: 'cancel', when: '用户明确要求恢复且保存着废弃前previous草稿', capabilityId: 'finance-setting-cat-config-update', mapping: { draft: 'context.previousDraft' }, instruction: '用previous(status=1)作为完整update draft补偿恢复；页面列表无法直接提供已废弃行，必须依赖保存的previous或受控后端查询。' },
    ],
    completion: '只有启用树刷新后确认目标ID消失，才能报告页面可见状态已废弃；true不等于独立终态证据。',
    idempotency: '后端没有幂等键；这是绝对status=0更新，同一草稿重复目标终态相同但可能更新时间变化。超时先刷新启用树并核对，未核实前不要重复写；恢复必须使用操作前完整previous。',
  }),
}

export const FINANCE_SETTING_CAT_CONFIG_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_CAT_CONFIG_METHODS).map(([capabilityId, method]) => {
    const source = FINANCE_SETTING_CAT_CONFIG_AI_CONTRACTS[capabilityId]!
    return [`financeSettingCatConfig.${method}`, {
      ...source,
      boundaries: [
        ...source.boundaries,
        `公开方法签名financeSettingCatConfig.${method}(args)，单个对象参数；list可省略args。能力invoke同样使用对象，字段与inputs一致。`,
      ],
    }]
  }),
)
