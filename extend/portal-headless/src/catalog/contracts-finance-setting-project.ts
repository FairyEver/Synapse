import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_SETTING_PROJECT_METHODS, financeSettingProjectCapabilities } from '../capabilities/finance-setting-project.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })

const statusOptions = [{ value: 0, label: '停用' }, { value: 1, label: '启用' }]
const typeOptions = [{ value: 1, label: '生物技术类' }, { value: 2, label: '信息技术类' }, { value: 3, label: '工程类' }]
const attributeOptions = [{ value: 1, label: '自主开发项目' }, { value: 2, label: '外部科研项目' }, { value: 3, label: '受托开发项目' }]
const stageOptions = [{ value: 1, label: '研究阶段' }, { value: 2, label: '开发阶段' }]

const id = input('项目主键ID；不是负责人ID、所属公司ID或项目编号', 'finance-setting-project-list.list[].id 或 finance-setting-project-create 根返回值', {
  type: 'string | number', constraints: ['必须是安全正整数或无前导零的正整数字符串；不要用项目名称或列表下标代替'],
})
const projectName = input('项目名称；新增表单必填，编辑页面禁用', '用户输入或finance-setting-project-get返回值.projectName', {
  type: 'string', constraints: ['去首尾空白后不能为空；最多500个字符，发送时保留原字符串'],
})
const projectCode = input('项目编号；新增表单必填，编辑页面禁用', '用户输入或finance-setting-project-get返回值.projectCode', {
  type: 'string', constraints: ['去首尾空白后不能为空；最多500个字符，启用时后端要求同一租户内启用项目编号不重复'],
})
const projectType = input('项目类型字典值', '用户从财务项目类型字典选择；编辑页面禁用', { type: 'integer', options: typeOptions })
const projectAttribute = input('项目属性字典值', '用户从财务项目属性字典选择；编辑页面禁用', { type: 'integer', options: attributeOptions })
const companyId = optional('所属公司主键ID；不是组织树名称', '用户从organization-tree返回的可选公司节点中选择', '未选择公司时SDK发送null', { type: 'string | number', nullable: true, nullMeaning: '不设置所属公司' })
const companyName = optional('所属公司名称快照；由页面根据组织树选择补齐', 'organization-tree节点.name或详情返回值.companyName', '省略时SDK发送空字符串；后端以companyId为关联主键', { type: 'string' })
const principalStaffId = input('课题负责人用户ID；不是负责人姓名或工号', 'finance-setting-project-user-search.list[].id，用户选中一名候选', { type: 'string | number', constraints: ['必须先通过带关键字的人员搜索取得；后端要求非空'] })
const principalStaffNo = optional('课题负责人工号快照', 'finance-setting-project-user-search.list[].username或详情返回值.principalStaffNo', '省略时SDK发送空字符串；不把工号当principalStaffId', { type: 'string' })
const principalName = optional('课题负责人姓名快照', 'finance-setting-project-user-search.list[].realName或详情返回值.principalName', '省略时SDK发送空字符串；不把姓名当principalStaffId', { type: 'string' })
const status = optional('项目绝对状态：0停用、1启用', '用户明确选择或页面当前详情.status', '新增默认1启用；编辑保留current.status', { type: 'integer', options: statusOptions })
const stages = optional('项目阶段日期数组；页面固定维护研究阶段1和开发阶段2', '用户在编辑页两个日期选择器中填写，或详情.stages', '省略时SDK补为两个空日期阶段；空日期以空字符串发送，详情中的null保持null', { type: 'array' })
const stage = input('一个项目阶段编码：1研究阶段或2开发阶段', 'stages[]中的stage', { type: 'integer', options: stageOptions })
const startDate = optional('阶段开始日期', '用户日期选择器，YYYY-MM-DD', '未填写时发送空字符串（详情中的null保持null）', { type: 'string | null', nullable: true, format: 'YYYY-MM-DD；仅日期，不做时区换算', nullMeaning: '详情响应明确为null时保持null' })
const endDate = optional('阶段结束日期', '用户日期选择器，YYYY-MM-DD', '未填写时发送空字符串（详情中的null保持null）', { type: 'string | null', nullable: true, format: 'YYYY-MM-DD；仅日期，不做时区换算', nullMeaning: '详情响应明确为null时保持null' })

const listInputs: Record<string, AiParameter> = {
  projectName: optional('项目名称模糊筛选文本', '用户输入', 'SDK发送null，不增加名称筛选', { type: 'string', nullable: true, nullMeaning: '不按项目名称筛选' }),
  projectCode: optional('项目编号筛选文本', '用户输入', 'SDK发送null，不增加编号筛选', { type: 'string', nullable: true, nullMeaning: '不按项目编号筛选' }),
  projectTypes: optional('项目类型字典值数组', '用户在多选项目类型中选择的值', 'SDK发送空数组；不限制项目类型', { type: 'array', nullable: false }),
  projectAttributes: optional('项目属性字典值数组', '用户在多选项目属性中选择的值', 'SDK发送空数组；不限制项目属性', { type: 'array', nullable: false }),
  stages: { ...stages, meaning: '当前阶段筛选字典值数组', source: '用户在多选阶段管理中选择的值', omitted: 'SDK发送空数组；不限制当前阶段', required: false },
  companyIds: optional('所属公司ID数组', '用户从organization-tree中多选可选公司节点', 'SDK发送null；不限制所属公司', { type: 'array', nullable: true, nullMeaning: '不按所属公司筛选' }),
  principalName: optional('课题负责人姓名筛选文本', '用户输入', 'SDK发送null，不增加负责人筛选', { type: 'string', nullable: true, nullMeaning: '不按负责人姓名筛选' }),
  status: { ...status, meaning: '项目列表状态筛选', source: '用户状态单选或页面默认值', required: false },
  pageNo: optional('从1开始的页码', '调用方分页状态', 'SDK默认1', { type: 'integer', constraints: ['正整数'] }),
  pageSize: optional('当前页请求条数', '调用方分页状态', 'SDK默认20；只接受10、20、50、100', { type: 'integer', constraints: ['不接受-1全量'] }),
}

const createInputs: Record<string, AiParameter> = {
  projectName,
  projectCode,
  projectType,
  projectAttribute,
  companyId,
  companyName,
  principalStaffId,
  principalStaffNo,
  principalName,
  status,
  stages,
  'stages[]': { type: 'object', required: true, meaning: '一个阶段对象；页面只生成stage=1和stage=2两项', source: '用户填写的阶段日期或SDK默认阶段' },
  'stages[].stage': stage,
  'stages[].startDate': startDate,
  'stages[].endDate': endDate,
}

const current = input('编辑前的完整项目详情；必须来自最新get，不能只凭列表显示字段拼造', 'finance-setting-project-get返回的对象或prepare-update.previous', { type: 'object', constraints: ['必须包含id、名称、编号、类型、属性、负责人ID、状态和stages；基础字段在编辑页不可修改'] })
const changes = optional('本次阶段日期编辑变更；只允许stages', '用户明确修改的两个阶段日期', '省略或传null表示保留current.stages，不修改阶段日期', { type: 'object | null', nullable: true, nullMeaning: '没有阶段字段变更', constraints: ['禁止通过changes修改项目名称、编号、类型、属性、公司、负责人或status'] })
const currentStatus = input('调用启用/停用前列表行的当前绝对状态', 'finance-setting-project-list.list[].status或最新get.status', { type: 'integer', options: statusOptions, constraints: ['enable要求当前值为0；disable要求当前值为1'] })

function stageFields (prefix: string): AiField[] {
  return [
    field(`${prefix}.stage`, 'integer', '阶段编码；1研究阶段、2开发阶段', { values: { '1': '研究阶段', '2': '开发阶段' } }),
    field(`${prefix}.startDate`, 'string', '阶段开始日期原值', { nullable: true, nullMeaning: '详情响应为null；空字符串表示页面未填写', format: 'YYYY-MM-DD或空字符串' }),
    field(`${prefix}.endDate`, 'string', '阶段结束日期原值', { nullable: true, nullMeaning: '详情响应为null；空字符串表示页面未填写', format: 'YYYY-MM-DD或空字符串' }),
    field(`${prefix}.id`, 'string | number', '阶段记录主键；仅详情/编辑快照可能存在，不能当项目ID', { optional: true }),
    field(`${prefix}.stageName`, 'string', '阶段名称快照；页面由字典标签显示', { optional: true, nullable: true, nullMeaning: '后端未返回阶段名称' }),
  ]
}

function projectFields (prefix: string): AiField[] {
  const at = (name: string) => prefix ? `${prefix}.${name}` : name
  return [
    field(at('id'), 'string | number', '项目主键ID；启停、编辑和删除使用此ID'),
    field(at('projectName'), 'string', '项目名称', { nullable: true, nullMeaning: '后端未返回项目名称；不能据此确认创建成功' }),
    field(at('projectCode'), 'string', '项目编号；启用项目在后端要求同租户不重复', { nullable: true, nullMeaning: '后端未返回项目编号' }),
    field(at('projectType'), 'integer', '项目类型字典值；1生物技术类、2信息技术类、3工程类', { nullable: true, nullMeaning: '后端未返回项目类型', values: { '1': '生物技术类', '2': '信息技术类', '3': '工程类' } }),
    field(at('projectAttribute'), 'integer', '项目属性字典值；1自主开发、2外部科研、3受托开发', { nullable: true, nullMeaning: '后端未返回项目属性', values: { '1': '自主开发项目', '2': '外部科研项目', '3': '受托开发项目' } }),
    field(at('companyId'), 'string | number', '所属公司主键ID', { nullable: true, nullMeaning: '未设置所属公司' }),
    field(at('companyName'), 'string', '所属公司名称', { nullable: true, nullMeaning: '后端未返回公司名称' }),
    field(at('principalStaffId'), 'string | number', '课题负责人用户ID', { nullable: true, nullMeaning: '后端未返回负责人ID' }),
    field(at('principalStaffNo'), 'string', '课题负责人工号', { nullable: true, nullMeaning: '后端未返回工号' }),
    field(at('principalName'), 'string', '课题负责人姓名', { nullable: true, nullMeaning: '后端未返回姓名' }),
    field(at('status'), 'integer', '项目绝对状态：0停用、1启用', { values: { '0': '停用', '1': '启用' } }),
    field(at('createTime'), 'string', '创建时间原值，不做时区换算', { optional: true, nullable: true, nullMeaning: '后端未返回创建时间' }),
    field(at('stages'), 'array', '项目阶段记录数组；列表和详情均用于展示/编辑日期'),
    field(`${at('stages')}[]`, 'object', '一条阶段记录'),
    ...stageFields(`${at('stages')}[]`),
    field(at('updateTime'), 'string', '页面声明的更新时间列；当前Java Response VO未声明此字段，若部署返回则原样保留', { optional: true, nullable: true, nullMeaning: '当前固定Java VO没有该字段或响应未返回', constraints: ['不能因该字段缺席推断更新失败'] }),
  ]
}

const pageOutput: AiContract['output'] = {
  shape: '{ list: array, total: integer }',
  fields: [field('$', 'object', '项目当前分页结果'), field('list', 'array', '当前页项目记录，不是全部项目'), field('list[]', 'object', '一条项目列表记录'), ...projectFields('list[]'), field('total', 'integer', '符合当前筛选条件的记录总数，不是当前页长度')],
  empty: 'list=[]且total=0表示当前筛选范围没有记录；list=[]且total>0表示当前页为空；权限、网络或业务错误抛出，不会转为空列表。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object', fields: [field('$', 'object', '项目详情对象'), ...projectFields('')],
  empty: '后端不存在该ID时请求失败而不是返回空草稿；不能把失败当成可创建或可编辑的记录。',
}

const booleanOutput: AiContract['output'] = {
  shape: 'boolean', fields: [field('$', 'boolean', '后端成功标志；SDK只接受true，不包含更新后的详情或删除条数', { values: { true: '后端接受请求' } })],
  empty: '成功返回true；false、缺失或其它响应值抛错。true仍需按步骤回查实际持久化状态。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/menus/finance.js:6,37', kind: 'reference', note: '证明菜单标题项目管理、菜单路径和permission=/dashboard/finance/setting/project；financeListPermissionSwitch=true。' },
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/project/list.vue', kind: 'reference', note: '证明列表字段、筛选默认值、page路径、详情/编辑/新增路由、启停/删除请求和五个按钮权限码；页面无导入导出按钮。' },
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/project/[mode]/[id].vue 与 detail/[id].vue', kind: 'reference', note: '证明GET详情、表单字段、编辑态基础字段禁用、阶段日期校验、create POST和update PUT payload；不是浏览器网络实测。' },
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/components/portal/finance/tree-select/post-tree/index.vue', kind: 'reference', note: '证明公司树实际请求getRoleOrganizationTreeNew，params.excludePost=false，companyOnly由组件本地过滤法人节点。' },
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/components/portal/finance/select/user/index.vue 与 use-paged-user-options.js', kind: 'reference', note: '证明负责人候选按关键字分页请求/sys/user/getUserBasicInfoPage，statusList=1,4，返回id/realName/username并由页面拼接标签；SDK搜索接口强制关键字以避免全量拉取。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 FinanceProjectController、FinanceProject*ReqVO/RespVO、FinanceProjectServiceImpl及financeproject枚举', kind: 'reference', note: '证明finance/project的CRUD、enable/disable、分页字段、阶段校验、启用编号唯一性和删除引用保护；固定检出未pull，不能替代部署环境证据。' },
  { source: 'src/capabilities/finance-setting-project.ts', kind: 'implementation', note: '证明SDK请求投影、页面表单校验、阶段归一、启停状态保护和返回值校验。' },
  { source: 'test/finance-setting-project.test.ts', kind: 'test', note: '离线request stub锁定源码动作、请求载荷、权限/moduleType声明、阶段规则和AI契约；不发真实网络。' },
]

const gaps = [
  '本轮未启动浏览器，未取得该页面的独立网络基准、真实响应字段变体或真实账号权限结果；请求形状来自固定Portal源码、固定Java源码和离线stub。',
  '固定Portal检出d3cf56bdc7和固定Java检出dcb3f360194按任务要求未执行pull；它们不是本次部署版本的独立证明。',
  '未在真实测试环境执行创建、编辑、启停、删除，未完成真实写入后的列表/详情回查，也未执行用户要求中的prepare→submit→cancel；本页没有取消或补偿接口，阶段恢复只能再次PUT。',
  'Portal列表和详情模板声明updateTime，但固定Java FinanceProjectRespVO没有该字段；SDK将它标为可选并不据缺失判断写入成功。',
  '页面使用的运行时finance_project_type、finance_project_attribute字典标签未通过浏览器独立观测；1/2/3标签来自固定Java枚举，部署扩展未验证。',
  '项目/options、current-stage、fee-item-options由其他页面调用，固定源码未显示本页面调用；本页契约没有发布这些跨页面动作，也未验证其部署行为。',
]

const boundaries = [
  '只覆盖财务设置→项目管理页面及其可达新增、编辑、详情子页：列表、详情、公司组织树、负责人搜索、创建、编辑阶段、启用、停用、删除；不覆盖导入导出，因为本页没有对应按钮或请求。',
  '页面菜单权限为/dashboard/finance/setting/project；按钮还分别受finance:setting:project:create、update、delete、enable、disable、query控制。SDK不把菜单可见当成后端授权证明。',
  '所有能力使用platform HTTP实例，页面module-type为null，调用时不发送module-type；tenant-id和会话token仍由SDK会话绑定负责。',
  '列表阶段筛选由后端服务按今天日期解析阶段；SDK只发送页面选择的阶段编码数组，不把列表阶段筛选扩大成projectIds输入。',
  '编辑页基础字段全部禁用，后端update实际只替换stages；SDK禁止通过changes修改项目名称、编号、类型、属性、公司、负责人或status。',
  '页面没有本地导入导出能力；同控制器的options、current-stage和fee-item-options属于其它财务单据页面，不能从本页标题推断为本页动作。',
]

const prerequisites = [
  '已建立带有效会话token与tenantId的SDK；账号需同时具备页面及所调用按钮/候选数据权限。',
  '项目负责人必须先用带非空姓名关键字的user-search取得候选，再把同一候选的id传入创建或详情快照；不能猜用户ID。',
  '编辑、启停和删除的项目ID应来自最新列表或详情；写请求正常返回仍需独立回查，不能把true或新建ID当成已审批或已展示。',
]

const failures = [
  '名称/编号为空或超过500字符、负责人ID无效、枚举值不在源码已知范围、阶段日期只填一端或阶段顺序冲突：SDK在发请求前拒绝，修正后再调用。',
  '启用要求当前status=0，停用要求当前status=1；不满足页面按钮条件时不发请求。启用时后端还会拒绝同租户已占用的启用项目编号。',
  '401/403、HTTP错误、后端业务错误或响应不是预期的分页/对象/true/ID：原样抛错，不改写为空列表或成功。',
  '创建/编辑/启停/删除超时或断网时结果不确定：按项目ID或项目编号回查列表/详情后再决定；禁止盲目重复创建或用删除代替未确认的补偿。删除被付款单/差旅申请引用时后端拒绝，先处理引用。',
]

function contract (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'> & Partial<Pick<AiContract, 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>>): AiContract {
  return {
    whenToUse: '操作门户系统“财务设置→项目管理”页面；不用于科技项目管理、财务项目下拉候选或费用项目选项接口。',
    boundaries,
    prerequisites,
    failures,
    evidence,
    gaps,
    ...value,
  }
}

const C: Record<string, AiContract> = {}

C['finance-setting-project-list'] = contract({
  purpose: '按项目名称、编号、类型、属性、当前阶段、所属公司、负责人和状态分页查询财务项目列表，返回详情、编辑、启停和删除所需的项目ID与字段。',
  effect: 'read', inputs: listInputs, output: pageOutput,
  consume: ['展示list[]中的项目名称、编号、类型、属性、公司、负责人和status；字典值按values解释，未知部署值不要擅自改写。', '用list[].id映射详情、启停、删除；需要筛选当前阶段时保留stages数组和total，按页递增pageNo直到达到total或返回空页。'],
  steps: [
    { role: 'optional', when: '用户要查看或编辑某一行', capabilityId: 'finance-setting-project-get', mapping: { id: 'result.list[].id' }, instruction: '只传用户选中的同一行id；详情失败不能用列表行拼造完整编辑快照。' },
    { role: 'optional', when: '用户要启用当前停用项目', capabilityId: 'finance-setting-project-enable', mapping: { id: 'result.list[].id', currentStatus: 'result.list[].status' }, instruction: '只对status=0的行调用；调用前确认用户明确同意启用。' },
    { role: 'optional', when: '用户要停用当前启用项目', capabilityId: 'finance-setting-project-disable', mapping: { id: 'result.list[].id', currentStatus: 'result.list[].status' }, instruction: '只对status=1的行调用；停用后新建审批单不能再选择该项目。' },
    { role: 'optional', when: '用户确认删除某一行', capabilityId: 'finance-setting-project-remove', mapping: { id: 'result.list[].id' }, instruction: '保留被选行ID和编号；删除后按ID/编号回查，不能用同名第一条代替。' },
  ],
  completion: '已取得所请求页和total并交付列表字段；本能力不改变项目。', idempotency: null,
})

C['finance-setting-project-get'] = contract({
  purpose: '按项目主键读取详情，取得编辑阶段日期、基础字段、负责人快照和详情页展示字段。',
  effect: 'read', inputs: { id }, output: detailOutput,
  consume: ['展示基础字段和stages；编辑只能把用户的阶段日期变更放入prepare-update.changes.stages。', '保留详情中的id、projectCode和stages用于后续回查；createTime/updateTime是展示快照，不是成功证明。'],
  steps: [{ role: 'optional', when: '用户确认编辑阶段日期', capabilityId: 'finance-setting-project-prepare-update', mapping: { current: 'result.$' }, instruction: '只把该次get的同一详情作为current，再向用户收集日期变化。' }],
  completion: '返回同一项目的详情对象；不代表项目处于启用状态或阶段已通过其它业务审批。', idempotency: null,
})

C['finance-setting-project-organization-tree'] = contract({
  purpose: '读取项目页面所属公司的组织树，供列表多选和新增表单单选使用。',
  effect: 'read', inputs: {},
  output: { shape: 'array', fields: [field('$', 'array', '组织树根节点数组'), field('[]', 'object', '一个组织节点'), field('[].id', 'string | number', '组织节点ID；提交companyId/companyIds使用'), field('[].name', 'string', '组织节点名称'), field('[].pid', 'string | number', '父组织ID', { optional: true, nullable: true, nullMeaning: '根节点或响应未提供父级' }), field('[].isCorporation', 'number | boolean', '是否法人公司节点；页面companyOnly据此决定可选性', { optional: true, nullable: true, nullMeaning: '响应未提供法人标记' }), field('[].children', 'array', '直接子节点')], empty: '[]表示当前会话可见组织树为空；网络或权限错误抛出。' },
  consume: ['递归遍历children；列表多选和表单单选只选择页面companyOnly规则允许的法人公司节点。', '将节点id传为create.companyId或list.companyIds，名称只作为companyName展示快照，不能代替ID。'],
  steps: [], completion: '已交付当前会话可见的组织树；不代表树中每个节点都可被页面选择。', idempotency: null,
})

C['finance-setting-project-user-search'] = contract({
  purpose: '按非空姓名关键字分页搜索项目负责人候选，只返回页面下拉所需的在职/返聘人员字段。',
  effect: 'read', inputs: { keyword: input('人员姓名搜索关键字', '用户提供的非空关键字', { type: 'string', constraints: ['必须包含非空白字符；SDK不会无关键字全量拉取'] }), pageNo: optional('候选页码', '调用方分页状态', 'SDK默认1', { type: 'integer' }), pageSize: optional('候选页大小', '调用方分页状态', 'SDK默认20，最大100', { type: 'integer', constraints: ['1至100整数'] }) },
  output: { shape: '{ list: array, total: integer }', fields: [field('$', 'object', '负责人候选分页结果'), field('list', 'array', '当前候选页'), field('list[]', 'object', '一个负责人候选'), field('list[].id', 'string | number', '用户ID；create.principalStaffId使用'), field('list[].realName', 'string', '真实姓名'), field('list[].username', 'string', '负责人工号；create.principalStaffNo可使用'), field('list[].label', 'string', '页面显示标签，格式为realName(username)'), field('total', 'integer', '符合关键字和statusList=1,4的候选总数')], empty: 'list=[]表示该关键字当前页没有在职/返聘候选；不能把空结果当成用户不存在于所有状态。' },
  consume: ['向用户展示list[].label并让用户选定一项；把同一项的id、username、realName分别映射到创建字段，不要凭标签解析ID。', '按total分页，不能无关键字改成全量读取。'], steps: [], completion: '返回带关键字的候选页；不创建或修改用户。', idempotency: null,
})

C['finance-setting-project-prepare-create'] = contract({
  purpose: '在本地复刻新增项目表单校验，补齐id为空字符串、状态1和研究/开发两个空阶段，生成可提交草稿。',
  effect: 'prepare', inputs: createInputs, output: { shape: '{ draft: object }', fields: [field('$', 'object', '本地准备结果'), field('draft', 'object', '可传给create的创建载荷'), ...projectFields('draft')], empty: '非法输入抛错，不返回空草稿；合法输入返回完整表单草稿。' },
  consume: ['检查principalStaffId来自user-search，companyId来自organization-tree；阶段日期两端必须同时填写。', '准备只读，不检查项目编号是否已被启用记录占用，也不分配项目ID。'],
  steps: [{ role: 'required', when: '用户确认保存本地草稿', capabilityId: 'finance-setting-project-create', mapping: { projectName: 'result.draft.projectName', projectCode: 'result.draft.projectCode', projectType: 'result.draft.projectType', projectAttribute: 'result.draft.projectAttribute', companyId: 'result.draft.companyId', companyName: 'result.draft.companyName', principalStaffId: 'result.draft.principalStaffId', principalStaffNo: 'result.draft.principalStaffNo', principalName: 'result.draft.principalName', status: 'result.draft.status', stages: 'result.draft.stages' }, instruction: '逐字段提交draft；不要把organization-tree节点对象或user-search候选对象整体塞入请求。' }],
  completion: '仅完成本地表单准备，尚未创建项目。', idempotency: null,
})

C['finance-setting-project-create'] = contract({
  purpose: '按新增项目表单创建一个财务项目，返回后端分配的项目主键。',
  effect: 'write', inputs: createInputs, output: { shape: 'string | number', fields: [field('$', 'string | number', '新创建项目主键；不是负责人ID或公司ID')], empty: '正常返回项目ID；失败抛错，不把空值当创建成功。' },
  consume: ['成功返回的ID只表示后端创建接口返回主键；按该ID调用get或list回查全部字段，才能确认项目和阶段已持久化。'],
  steps: [{ role: 'required', when: '创建返回项目ID后或请求超时需要核实', capabilityId: 'finance-setting-project-get', mapping: { id: 'result.$' }, instruction: '按根返回ID读取详情并核对名称、编号、类型、属性、负责人及stages；超时也先回查再重试。' }],
  completion: '请求正常返回项目ID；独立详情回查成功且字段一致后，才能报告记录已创建。', idempotency: 'Portal后端没有requestId防重键；重复create可能产生重复项目，超时或断网必须先按返回ID/编号回查，不能盲目重发。',
})

const updateInputs = { current, 'current.id': id, changes, 'changes.stages': { ...stages, source: '用户明确修改的阶段日期数组', required: false } }
C['finance-setting-project-prepare-update'] = contract({
  purpose: '以最新项目详情为当前值，只合并页面允许编辑的阶段日期，并保留编辑前快照。',
  effect: 'prepare', inputs: { ...updateInputs, 'current.stages': stages, 'current.stages[].stage': stage, 'current.stages[].startDate': startDate, 'current.stages[].endDate': endDate },
  output: { shape: '{ draft: object, previous: object }', fields: [field('$', 'object', '本地编辑准备结果'), field('draft', 'object', '合并后的完整PUT草稿'), ...projectFields('draft'), field('previous', 'object', '编辑前页面字段快照，不是服务端事务版本'), ...projectFields('previous')], empty: 'current缺字段或日期规则不合法时抛错；不会返回不完整草稿。' },
  consume: ['确认draft.id与previous.id相同；只比较stages日期变化，基础字段保持current原值。', 'previous只能用于用户明确要求的补偿恢复；恢复是再次PUT，不是服务端回滚。'],
  steps: [{ role: 'required', when: '用户确认保存阶段日期', capabilityId: 'finance-setting-project-update', mapping: { current: 'result.draft', changes: 'literal:{}' }, instruction: '把完整draft作为current并传空changes，避免再次叠加其它未经确认的字段。' }, { role: 'cancel', when: '用户要求撤销已经保存的阶段修改且确认没有并发变更', capabilityId: 'finance-setting-project-update', mapping: { current: 'result.draft', 'changes.stages': 'result.previous.stages' }, instruction: '以previous.stages再次PUT；完成后按同一ID回查。页面没有cancel接口，不能声称这是事务回滚。' }],
  completion: '已形成阶段更新草稿，尚未写入。', idempotency: null,
})

C['finance-setting-project-update'] = contract({
  purpose: '提交财务项目的阶段日期修改；基础项目字段随页面表单快照带回但不可通过changes修改。',
  effect: 'write', inputs: { ...updateInputs, 'current.stages': stages }, output: booleanOutput,
  consume: ['SDK发送完整页面表单快照和规范化后的stages；后端update实际替换该项目的阶段记录，返回true不含详情。'],
  steps: [{ role: 'required', when: '更新返回true或请求超时需要核实', capabilityId: 'finance-setting-project-get', mapping: { id: 'args.current.id' }, instruction: '按同一ID回查stages；请求超时不要自动重发，先判断阶段最终状态。' }],
  completion: 'PUT正常返回true；同一ID详情回查并确认目标stages一致后，才能报告阶段修改已生效。', idempotency: '重复update不会使用SDK幂等键；同一阶段载荷通常是同一终态，但超时仍需先回查，不能把true当成详情。',
})

function statusContract (idValue: string, title: string, target: 0 | 1, path: 'enable' | 'disable'): void {
  C[idValue] = contract({
    purpose: `${title}一个财务项目，使用页面按当前状态显示的绝对操作。`, effect: 'write', inputs: { id, currentStatus }, output: booleanOutput,
    consume: [`${path === 'enable' ? '启用' : '停用'}请求只发送项目ID；目标状态由接口路径决定，不传toggle或status body。`],
    steps: [{ role: 'required', when: `请求返回true或超时需要确认项目是否${target === 1 ? '启用' : '停用'}`, capabilityId: 'finance-setting-project-get', mapping: { id: 'args.id' }, instruction: `回查详情.status；只有等于${target}时才报告${title}已验证，其他值或查询失败都不能猜。` }],
    completion: `PUT正常返回true；详情回查status=${target}后才确认${title}已生效。`, idempotency: '接口没有SDK requestId；启停写入绝对状态，同一载荷重复执行终态通常相同，但超时仍需回查后再决定是否重试。',
  })
}
statusContract('finance-setting-project-enable', '启用', 1, 'enable')
statusContract('finance-setting-project-disable', '停用', 0, 'disable')

C['finance-setting-project-remove'] = contract({
  purpose: '按项目主键删除一个财务项目；页面删除前有确认框，SDK只执行调用方已确认的请求。', effect: 'write', inputs: { id }, output: booleanOutput,
  consume: ['删除前保留项目ID和projectCode；后端若项目被付款单或差旅申请引用会拒绝删除。', '删除返回true后按原ID调用get或list核实；详情不存在或列表不再出现才可报告物理删除已验证。'],
  steps: [{ role: 'required', when: '删除返回true或超时需要核实', capabilityId: 'finance-setting-project-get', mapping: { id: 'args.id' }, instruction: '按同一ID回查；若后端返回不存在，结合删除请求结果判断；网络不确定时不能盲目重删。' }],
  completion: 'DELETE正常返回true；独立回查确认原ID不存在后，才报告删除已验证。', idempotency: '删除没有SDK或后端requestId；重复删除可能返回业务错误，超时先回查，不自动重发。',
})

export const FINANCE_SETTING_PROJECT_CONTRACTS = C
export const FINANCE_SETTING_PROJECT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_SETTING_PROJECT_METHODS).map(([capabilityId, method]) => [
    `financeSettingProject.${method}`,
    { ...C[capabilityId]!, boundaries: [...C[capabilityId]!.boundaries, method === 'remove' ? '公开方法financeSettingProject.remove(id)接收单个位置参数；能力invoke接收{id}对象。' : `公开方法financeSettingProject.${method}(input)接收单个对象参数；字段与能力inputs一致。`] },
  ]),
)

if (financeSettingProjectCapabilities.length !== Object.keys(FINANCE_SETTING_PROJECT_CONTRACTS).length) throw new Error('项目管理AI契约与能力定义数量不一致')
