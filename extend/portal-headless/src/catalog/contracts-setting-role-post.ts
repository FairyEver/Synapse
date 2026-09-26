import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SETTING_ROLE_POST_METHODS, settingRolePostCapabilities } from '../capabilities/setting-role-post.js'

const definitions = new Map(settingRolePostCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const roleFields = [
  field('id', 'string | number', '角色ID；保存岗位角色关系时使用此ID', { source: 'Portal角色接口' }),
  field('name', 'string | null', '角色名称；页面用于显示和选择', { nullable: true, nullMeaning: '后端未返回角色名称' }),
  field('useSystem', 'integer | null', '角色所属系统类型值；页面按系统选项解释', { nullable: true, nullMeaning: '后端未返回系统类型' }),
]

const roleTreeFields: AiField[] = [
  field('[]', 'object[]', '角色筛选树根节点'),
  field('[].id', 'string | number', '角色或角色树节点ID；作为列表roleId筛选值'),
  field('[].name', 'string', '角色树节点名称；页面本地搜索使用'),
  field('[].children', 'object[]', '子角色节点；叶节点为空数组'),
  field('[].children[].id', 'string | number', '子角色节点ID'),
  field('[].children[].name', 'string', '子角色节点名称'),
  field('[].children[].children', 'object[]', '更深层子角色；没有子节点时为空数组'),
]

const rowOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('list', 'object[]', '当前页岗位角色列表'),
    field('total', 'number', '符合岗位名称和角色筛选条件的岗位总数，不是当前页长度'),
    field('list[].postId', 'string | number', '岗位ID；读取已分配角色、岗位人员和保存关系时使用'),
    field('list[].postName', 'string | null', '岗位名称；null表示后端未返回名称', { nullable: true, nullMeaning: '后端未返回岗位名称' }),
    field('list[].roleNameList', 'string[]', '该岗位已分配角色名称；没有角色时SDK归一为空数组'),
  ],
  empty: 'list=[]且total=0表示筛选下没有岗位；权限、网络或响应形状错误会抛出，不能解释为空列表。',
}

const roleOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: roleFields,
  empty: '空数组表示该岗位当前没有可返回的已分配角色或系统筛选没有角色；请求错误不会降级为空数组。',
}

const userOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('list', 'object[]', '当前岗位人员分页'),
    field('total', 'number', '符合岗位、姓名和组织条件的在职人员总数，不是当前页长度'),
    field('list[].id', 'string | number', '用户ID；后端人员记录主键，页面当前只展示姓名/类型/组织'),
    field('list[].realName', 'string | null', '人员姓名；null表示后端未返回姓名', { nullable: true, nullMeaning: '后端未返回姓名' }),
    field('list[].sourceType', 'integer | null', '岗位权限来源：1主岗位，2兼职岗位；未知值不能擅自映射', { nullable: true, nullMeaning: '后端未返回来源' }),
    field('list[].orgfullpath', 'string | null', '人员所属组织全路径；null表示后端未返回组织路径', { nullable: true, nullMeaning: '后端未返回组织路径' }),
  ],
  empty: 'list=[]且total=0表示该岗位筛选下没有在职人员；不能把它解释为岗位不存在或无权限。',
}

const preparationOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [
    field('draft', 'object', '尚未发送请求的岗位角色全量替换草稿'),
    field('draft.postId', 'string | number', '要替换角色关系的岗位ID'),
    field('draft.roleIdList', '(string | number)[]', '去重后的角色ID数组；空数组代表按Portal语义清空全部岗位角色'),
  ],
  empty: 'prepare只在内存校验并生成草稿，不代表服务端已经修改；取消时丢弃draft。',
}

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', 'Portal保存成功包络没有业务返回值；Promise正常完成只表示请求完成')],
  empty: '请求抛错表示保存未被确认；成功或超时都必须回查岗位角色，不能把空返回当作详情。',
}

const evidence: AiContract['evidence'] = [
  { source: 'Portal test/portal/main@acab69acc77b6d6c0da21310cdfd26b91a01641e4：app/portal/menus/common.js、app/portal/views/dashboard/hr/setting/role-post/list.vue、components/user-list.vue、components/set-role.vue', kind: 'reference', note: '核对页面权限、platform实例、limit分页、岗位人员筛选、角色候选和全量替换保存行为。' },
  { source: 'Java test/test@0f1a55718ebc1987affb8bf245106e809dd51da4：HrPostRoleController、HrPostRoleServiceImpl、HrPostRoleDao.xml、HrPostRoleDTO、SysRoleEntity、SysUserBasicInfoDTO', kind: 'reference', note: '核对列表、已分配角色、岗位人员、保存端点、字段和保存先逻辑删除再插入的全量替换语义。' },
  { source: 'src/capabilities/setting-role-post.ts 与 test/setting-role-post.test.ts', kind: 'implementation', note: '锁定SDK请求投影、分页名、ID校验、角色去重、响应归一化和错误反证。' },
  { source: 'docs/pages/岗位角色.md', kind: 'reference', note: '记录本页四件套和真实验证边界。' },
]

const boundaries = [
  '只覆盖保留范围内的“系统设置 → 岗位角色”页面（/dashboard/setting/role-post/list）及页面实际可达的岗位角色列表、岗位人员查看、角色候选和分配保存；独立生产、财务、资产、采购、销售根模块页面不在本能力范围内。',
  '页面的系统下拉确实允许选择Portal定义的多个系统类型，包含生产等系统的角色选项；这只是岗位角色页面的字段值，不代表SDK实现了对应系统根模块页面或业务能力。',
  '所有请求使用platform实例；页面路径没有可推导的module-type规则，SDK不发送module-type。调用仍受当前会话、租户和后端权限控制。',
  '岗位人员组织树是Portal的无界全量树控件；SDK不发布该树的独立大结果能力，organizationId必须来自调用方已知组织上下文或其他已核实结果。',
  '页面有一个后端DELETE端点，但当前页面删除角色只是本地数组修改，最后统一POST全量关系；SDK不发布页面不可达的单条DELETE能力。',
  '角色筛选树请求体固定为Portal组件默认的[2,3]；Java接口实际按query中的useSystem/name过滤，忽略这个JSON body，不能把[2,3]描述成服务端项目筛选条件。',
]

function definitionOf (id: string) {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`岗位角色契约没有能力定义：${id}`)
  return definition
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitionOf(id)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: ['pageNo', 'limit', 'useSystem'].includes(parameter.name) ? 'number' : parameter.name === 'roleIdList' ? '(string | number)[]' : parameter.name === 'draft' ? 'object' : 'string | number | null',
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: 'Portal岗位角色页面的筛选、弹窗或prepare草稿；ID必须来自当前租户已核实结果。',
  }]))
}

const contracts: Record<string, AiContract> = {}
function add (id: string, value: Omit<AiContract, 'inputs'> & { inputs?: Record<string, AiParameter> }): void {
  definitionOf(id)
  contracts[id] = { ...value, inputs: { ...inputsOf(id), ...value.inputs } }
}

const readBase = (purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): Omit<AiContract, 'inputs'> => ({
  purpose,
  whenToUse: `当需要${purpose.replace(/[。；].*$/, '')}时使用。`,
  boundaries,
  effect: 'read',
  prerequisites: ['使用当前用户会话token、当前租户和岗位角色页面权限；岗位ID、角色ID和组织ID必须来自当前租户可见且已核实的数据。'],
  output,
  consume,
  steps: [],
  completion: '返回值符合本页字段契约；读到空列表不等于已验证无权限或对象不存在。',
  failures: ['ID、分页参数、响应形状或权限/网络错误按失败处理；不要把请求错误降级为空列表。'],
  idempotency: null,
  evidence,
  gaps: ['已完成Portal/Java源码核对和离线请求反证；尚未在真实测试环境执行本页读请求，也未执行真实岗位角色保存的prepare→submit→cancel/回查闭环。'],
  ...extra,
})

add('setting-role-post-list', readBase('查询岗位角色列表分页', rowOutput, [
  '按list[].postId作为后续读取岗位角色、查看岗位人员或保存分配的岗位ID；postName只作为展示和筛选语义，不可当ID。',
  'Portal请求固定携带order=""、orderField=""、postName、roleId、pageNo和limit；limit支持10、20、50、100，默认20。',
], { steps: [
  { role: 'optional', when: '用户选择某岗位查看已分配角色', capabilityId: 'setting-role-post-roles', mapping: { postId: 'result.list[].postId' }, instruction: '使用同一岗位ID读取角色对象，不从roleNameList反推角色ID。' },
  { role: 'optional', when: '用户选择某岗位查看人员', capabilityId: 'setting-role-post-users', mapping: { postId: 'result.list[].postId' }, instruction: '使用同一岗位ID查询在职人员；organizationId如需筛选必须另行取得真实组织ID。' },
]}))

add('setting-role-post-role-filter-options', readBase('读取岗位角色页面“分配角色”筛选树', { shape: 'object[]', fields: roleTreeFields, empty: '空数组表示当前会话下没有返回角色候选；请求错误不会降级为空数组。' }, [
  '页面加载时固定向allProjectRoleListNotBySystem发送JSON数组[2,3]；Java当前实现忽略该body，返回树后由页面本地搜索。',
  '选择叶节点的id后，把它作为setting-role-post-list的roleId筛选，不把节点name当作筛选ID。',
], { gaps: ['角色筛选树由页面无关键字一次性加载，SDK复刻页面请求但没有把无界树扩展成独立的全量组织能力；候选数量和树深度未在真实环境实测。'] }))

add('setting-role-post-roles', readBase('读取指定岗位当前已分配的角色', { ...roleOutput, empty: '空数组表示该岗位当前没有已分配角色；请求错误不会降级为空数组。' }, [
  '保留每个角色的id、name和useSystem；保存时只把id放入roleIdList，不能把角色名称或岗位ID混用。',
], { inputs: { postId: param('岗位ID，不是角色ID。', 'setting-role-post-list.list[].postId 或调用方已核实的岗位ID', { type: 'string | number', required: true }) } }))

add('setting-role-post-role-options-by-system', readBase('按系统读取设置角色弹窗的可分配角色', roleOutput, [
  'useSystem来自Portal系统选项；页面在系统切换后重新请求listByUseSystem，角色名称搜索在前端树控件本地完成。',
  '保存时只选择返回角色的id；useSystem仅用于筛选候选，不会自动写入保存请求。',
], { inputs: { useSystem: param('Portal系统类型值；用于筛选该系统的角色候选，不能用系统名称替代。', 'Portal设置角色弹窗的系统下拉', { type: 'number', required: true, constraints: ['必须为整数；页面实际下拉包含公共、人力、财务、资产、生产、采购、销售、科技、门户和平台等Portal系统值'] }) } }))

add('setting-role-post-users', readBase('查询指定岗位的在职人员分页', userOutput, [
  'sourceType=1解释为主岗位，sourceType=2解释为兼职岗位；未知值保留原数值，不能擅自映射。',
  'Portal请求还带order=""和orderField=""；realName和organizationId只是筛选条件。组织树本身不由本能力返回，organizationId必须来自已知组织上下文。Portal表单初始值为null；URL序列化时会省略null。',
], { inputs: {
  postId: param('岗位ID，不是用户ID。', 'setting-role-post-list.list[].postId 或调用方已核实的岗位ID', { type: 'string | number', required: true }),
  realName: param('人员姓名包含筛选；Portal表单初始值为null，输入框为空时发送null。', '查看人员弹窗的姓名输入框', { type: 'string | null', required: false, nullable: true, omitted: '发送null；Portal序列化到URL时会省略null' }),
  organizationId: param('所属组织ID筛选；不是组织名称。', '查看人员弹窗组织树的已知节点ID', { type: 'string | number | null', required: false, nullable: true, omitted: '发送null；Portal序列化到URL时会省略null' }),
} }))

add('setting-role-post-prepare-replace', {
  ...readBase('校验并准备岗位角色全量替换草稿', preparationOutput, [
    'roleIdList按Portal的Set语义去重；允许空数组，表示用户明确要清空该岗位全部角色。',
    'prepare不发请求；用户取消时丢弃draft，不能调用后端DELETE。',
  ], { effect: 'prepare', completion: '得到包含postId和去重roleIdList的尚未写入草稿。', idempotency: null }),
  inputs: {
    postId: param('要修改关系的岗位ID。', 'setting-role-post-list.list[].postId 或调用方已核实的岗位ID', { type: 'string | number', required: true }),
    roleIdList: param('用户最终确认的角色ID数组；来自setting-role-post-roles或按系统角色候选，允许空数组清空关系。', '用户在设置角色弹窗中增加、编辑、删除后的最终选择', { type: '(string | number)[]', required: true, constraints: ['每个ID必须为正整数；SDK按Portal顺序去重'] }),
  },
  steps: [
    { role: 'required', when: '用户确认保存设置角色', capabilityId: 'setting-role-post-replace', mapping: { draft: 'result.draft' }, instruction: '只提交prepare返回的完整draft；保存成功或超时后按postId重新读取roles核对最终关系。' },
    { role: 'cancel', when: '用户在保存前取消设置角色', instruction: '丢弃draft，不发送POST；页面没有服务端取消接口。' },
  ],
})

add('setting-role-post-replace', {
  ...readBase('保存指定岗位的完整角色分配', voidOutput, [
    '请求体严格为postId和roleIdList；后端先把岗位原有关系标记删除，再插入数组中的新关系，这是全量替换而不是增量追加。',
    'roleIdList为空会清空该岗位全部角色；这是Portal页面本地删除后点击保存的真实语义。',
  ], {
    effect: 'write',
    completion: '请求未抛错且随后回查setting-role-post-roles，确认返回的角色ID集合等于draft.roleIdList后，才报告分配保存完成；不代表角色权限审批或其他系统业务已生效。',
    idempotency: '后端没有requestId幂等协议；请求超时或结果不确定时先按draft.postId回查角色关系，未确认前不要盲目重发。重复全量提交可能覆盖期间他人对同一岗位的修改。',
    inputs: {
      draft: param('setting-role-post-prepare-replace返回的完整草稿。', 'setting-role-post-prepare-replace.draft', { type: 'object', required: true }),
      'draft.postId': param('草稿中的岗位ID。', 'setting-role-post-prepare-replace.draft.postId', { type: 'string | number', required: true }),
      'draft.roleIdList': param('草稿中的最终角色ID数组，空数组表示清空关系。', 'setting-role-post-prepare-replace.draft.roleIdList', { type: '(string | number)[]', required: true }),
    },
    steps: [{ role: 'required', when: 'POST成功或响应超时', capabilityId: 'setting-role-post-roles', mapping: { postId: 'args.draft.postId' }, instruction: '按同一岗位读取当前角色ID集合，逐项核对；不把HTTP成功或空返回当作已保存。' }],
  }),
})

export const SETTING_ROLE_POST_AI_CONTRACTS = contracts
export const SETTING_ROLE_POST_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_ROLE_POST_METHODS).map(([id, method]) => [`settingRolePost.${method}`, { ...SETTING_ROLE_POST_AI_CONTRACTS[id]!, boundaries: [...SETTING_ROLE_POST_AI_CONTRACTS[id]!.boundaries, `直接方法使用sdk.settingRolePost.${method}；岗位角色保存仍需先prepare再replace并回查。`] }]),
)
