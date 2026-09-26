import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SETTING_USER_METHODS, settingUserCapabilities } from '../capabilities/setting-user.js'

const definitions = new Map(settingUserCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const userFields: AiField[] = [
  field('id', 'string | number', '用户主键；Long 可能序列化为字符串，编辑时原样保留'),
  field('username', 'string | null', '用户名/工号；编辑表单展示但不可编辑', { nullable: true, nullMeaning: '后端未返回用户名' }),
  field('realName', 'string | null', '用户姓名；编辑表单展示但不可编辑', { nullable: true, nullMeaning: '后端未返回姓名' }),
  field('headUrl', 'string | null', '头像地址', { nullable: true, nullMeaning: '未设置头像' }),
  field('gender', 'integer | null', '性别；0男、1女、2保密', { nullable: true, nullMeaning: '后端未返回性别' }),
  field('email', 'string | null', '邮箱', { nullable: true, nullMeaning: '未填写邮箱' }),
  field('mobile', 'string | null', '手机号；非空时必须匹配Portal手机号格式', { nullable: true, nullMeaning: '未填写手机号' }),
  field('gradeId', 'string | number | null', '班级ID', { nullable: true, nullMeaning: '未关联班级' }),
  field('deptId', 'string | number | null', '部门ID', { nullable: true, nullMeaning: '未关联旧部门' }),
  field('status', 'integer | null', '用户状态；0停用、1启用', { nullable: true, nullMeaning: '后端未返回状态', values: { '0': '停用', '1': '启用' } }),
  field('createDate', 'string | number | null', '创建时间原值；SDK不做时区转换', { nullable: true, nullMeaning: '后端未返回创建时间' }),
  field('creator', 'string | number | null', '创建人ID', { nullable: true, nullMeaning: '后端未返回创建人' }),
  field('superAdmin', 'integer | null', '是否超级管理员；0否、1是', { nullable: true, nullMeaning: '后端未返回标记' }),
  field('roleIdList', '(string | number)[] | null', '用户角色ID数组；仅在角色编辑命令激活时页面显示选择器', { nullable: true, nullMeaning: '详情未返回角色ID数组' }),
  field('gradeName', 'string | null', '班级名称', { nullable: true, nullMeaning: '未关联班级' }),
  field('roleList', 'object[] | null', '角色对象数组；列表页面通过每项name展示', { nullable: true, nullMeaning: '详情接口未填充角色对象数组' }),
  field('organizationCode', 'string | number | null', '组织编码', { nullable: true, nullMeaning: '后端未返回组织编码' }),
  field('organizationName', 'string | null', '组织名称', { nullable: true, nullMeaning: '未返回组织名称' }),
  field('organizationFullPathName', 'string | null', '组织全路径名称', { nullable: true, nullMeaning: '未返回组织全路径' }),
  field('organizationId', 'string | number | null', '组织ID', { nullable: true, nullMeaning: '未关联组织' }),
  field('updaterName', 'string | null', '修改人名称', { nullable: true, nullMeaning: '后端未返回修改人' }),
  field('updateDate', 'string | number | null', '修改时间原值；SDK不做时区转换', { nullable: true, nullMeaning: '后端未返回修改时间' }),
  field('creatorName', 'string | null', '创建人名称', { nullable: true, nullMeaning: '后端未返回创建人名称' }),
  field('type', 'integer | null', '创建方式；1=HR同步、2=智慧蛋鸡同步', { nullable: true, nullMeaning: '后端未返回创建方式' }),
  field('project', 'integer | null', '所属项目；1=学习、2=绩效', { nullable: true, nullMeaning: '后端未返回项目' }),
  field('postId', 'string | number | null', '岗位ID', { nullable: true, nullMeaning: '未关联岗位' }),
  field('tenantId', 'string | number | null', '租户ID；不能用它切换会话租户', { nullable: true, nullMeaning: '后端未返回租户' }),
  field('tenantAdmin', 'integer | null', '是否租户管理员', { nullable: true, nullMeaning: '后端未返回标记' }),
  field('postName', 'string | null', '岗位名称', { nullable: true, nullMeaning: '未返回岗位名称' }),
  field('staffId', 'string | number | null', '员工ID', { nullable: true, nullMeaning: '未关联员工' }),
  field('setPwd', 'boolean | null', '是否已设置密码', { nullable: true, nullMeaning: '后端未返回密码状态' }),
]

const userOutput: AiContract['output'] = {
  shape: 'object',
  fields: userFields,
  empty: '找不到用户或响应不是对象会抛错；不能把空对象当作可编辑表单。',
}

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页用户记录'), field('total', 'number', '筛选结果总数，不是当前页长度'), ...userFields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[] 且 total=0 表示当前筛选没有记录；权限、网络或响应形状错误会抛出。',
}

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/common.js、app/portal/views/dashboard/hr/setting/user.vue、list.vue、[mode]/[id].vue @ bbcfc35154', kind: 'reference', note: '证明菜单权限、列表筛选与时间转换、平台实例、编辑动作、角色命令、手机号校验和实际提交字段。' },
  { source: 'HrSysUserController、SysUserDTO、HrSysUserServiceImpl、SysUserDao.xml @ b7a359adc9e', kind: 'reference', note: '证明page/getInfo/phoneIsExist/PUT端点、DTO字段、组织数据权限、角色更新和手机号占用检查。' },
  { source: 'src/capabilities/setting-user.ts 与 test/setting-user.test.ts', kind: 'implementation', note: '证明SDK最终请求形状、日期开区间、编辑payload、响应校验和离线反证；不替代真实环境写回查。' },
]

const contracts: Record<string, AiContract> = {}
const queryInputs: Record<string, AiParameter> = {
  staffCode: param('用户名/工号筛选文本。', 'Portal 用户名输入框', { required: false, type: 'string', omitted: '发送空字符串' }),
  name: param('姓名筛选文本。', 'Portal 姓名输入框', { required: false, type: 'string', omitted: '发送空字符串' }),
  mobile: param('手机号筛选文本。', 'Portal 手机号输入框', { required: false, type: 'string', omitted: '发送空字符串' }),
  role: param('角色ID。', 'Portal 角色选择器', { required: false, type: 'string | number', nullable: true, omitted: '发送空字符串' }),
  status: param('状态字典值。', 'Portal status 字典选择器', { required: false, type: 'string | number', nullable: true, omitted: '发送空字符串' }),
  time: param('创建日期范围的[startDate,endDate]；输入YYYY-MM-DD或带时间的日期字符串。', 'Portal a-range-picker；SDK将结束日加1天生成开区间endTime', { required: false, type: 'string[]', nullable: true, omitted: 'startTime和endTime均发送空字符串', constraints: ['只能为空数组或两项；结束日期不能早于开始日期'] }),
  pageNo: param('从1开始的页码。', 'Portal 分页状态', { required: false, type: 'number', omitted: '使用1' }),
  pageSize: param('每页条数。', 'Portal 分页状态', { required: false, type: 'number', omitted: '使用20', constraints: ['只能是10、20、50或100'] }),
}

function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Setting user contract has no definition: ${id}`)
  contracts[id] = value
}

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal“用户查询”列表和列表编辑入口。',
  boundaries: [
    '页面权限是/dashboard/setting/user；列表使用platform实例，页面路径不命中module-type规则，SDK不发送module-type。',
    '列表虽然声明deleteURL和exportURL，但当前页面没有删除或导出按钮；SDK不发布删除/导出能力。actionSync函数当前也未绑定可见按钮，SDK只发布Java已存在的同步端点，并将该静态页面缺口如实记录，不把它描述成当前按钮已可达。',
    '列表编辑动作进入[mode]/[id].vue并调用getInfo、PUT /sys/user；创建分支没有列表入口且表单缺少后端AddGroup必填password，SDK不把它伪装成可用create能力。',
    'roleIdList选择器默认被注释，仅通过setting-user-role-v2-edit命令或保持命令才显示；SDK只在调用方明确提供时保留它。',
  ],
  prerequisites: ['使用当前用户会话token、当前租户和页面权限；用户列表还受后端普通管理员组织数据范围限制。'],
  failures: ['表单校验、手机号占用、权限、组织数据范围、网络或响应形状错误原样报告；不能把空页或空对象当作权限成功。'],
  evidence,
  gaps: ['已完成 Portal/Java 逐页静态核对和离线请求断言；尚未在真实测试环境执行本页浏览器读请求，也未执行真实编辑的prepare→submit→cancel闭环。'],
})

add('setting-user-list', base({
  purpose: '按 Portal 用户查询条件读取当前用户可见的用户分页。',
  effect: 'read',
  inputs: queryInputs,
  output: listOutput,
  consume: ['按total和分页状态继续翻页；展示roleList[].name、status和创建/修改时间；保留list[].id作为编辑入口。', 'time会按Portal规则生成startTime=开始日00:00:00、endTime=结束日次日00:00:00，不能把结束日改成当天23:59:59。'],
  steps: [{ role: 'optional', when: '用户选择列表中的编辑动作', capabilityId: 'setting-user-get-info', instruction: '使用同一list[].id读取编辑表单；不要只拿列表展示字段直接覆盖保存。' }],
  completion: '返回当前筛选的一页和total；这只证明读取成功，不证明用户具有编辑权限。',
  idempotency: null,
}))

add('setting-user-get-info', base({
  purpose: '读取列表编辑入口对应的用户完整表单值。',
  effect: 'read',
  inputs: { id: param('用户主键。', 'setting-user-list.list[].id', { required: true, type: 'string | number' }) },
  output: userOutput,
  consume: ['保存完整返回对象作为prepareUpdate的current；手机号变更前先与旧mobile比较，只有变更且非空时调用phoneIsExist。', 'roleIdList来自getInfo的当前角色关系；默认页面不显示角色选择器，不能自行改角色。'],
  steps: [{ role: 'optional', when: '用户确认编辑并选择保存', capabilityId: 'setting-user-prepare-update', instruction: '基于完整详情和用户明确的username、realName、mobile、roleIdList变更生成提交草稿。' }],
  completion: '获得与Portal customLoad相同的完整用户对象。',
  idempotency: null,
}))

add('setting-user-phone-is-exist', base({
  purpose: '按编辑页手机号校验规则检查非空手机号是否已被其他用户占用。',
  effect: 'read',
  inputs: { phone: param('手机号；空字符串按Portal validator规则本地返回0，非空必须是1开头的11位手机号。', '用户编辑表单mobile字段', { required: true, type: 'string' }) },
  output: { shape: 'number', fields: [field('$', 'number', '匹配的用户数量；0表示当前查询没有占用记录')], empty: '空手机号不发请求并返回0；请求错误会抛出。' },
  consume: ['返回0才允许把变更后的手机号交给update；返回大于0时报告手机号已存在。Portal源码不发送userId排除参数。'],
  steps: [],
  completion: '获得后端手机号占用数量。',
  idempotency: null,
}))

add('setting-user-prepare-update', base({
  purpose: '在无网络副作用的情况下合并用户编辑变更，生成Portal完整保存草稿。',
  effect: 'prepare',
  inputs: {
    current: param('最新getInfo返回的完整用户对象。', 'setting-user-get-info', { required: true, type: 'object' }),
    changes: param('仅允许username、realName、mobile、roleIdList；页面默认username/realName/mobile禁用，roleIdList只有隐藏命令激活后可改。', '用户明确编辑意图', { required: false, type: 'object', nullable: true }),
  },
  output: { shape: '{ draft: object, previous: object }', fields: [field('draft', 'object', 'PUT /sys/user要发送的完整用户表单草稿，useSystemList固定为[1,2,3,4,5,6]'), field('previous', 'object', '提交前的完整用户表单草稿，用于取消时丢弃或明确恢复')], empty: 'current缺少id、username或realName会抛错，不生成半成品草稿。' },
  consume: ['手机号非空时必须符合Portal格式；手机号是否重复由phoneIsExist单独检查。', '用户取消时丢弃draft，不调用update；prepare本身不发请求。'],
  steps: [{ role: 'required', when: '用户确认保存且手机号占用检查通过', capabilityId: 'setting-user-update', instruction: '只提交draft；如果用户取消，丢弃draft并不调用update。' }, { role: 'cancel', when: '用户点击编辑页取消', instruction: '丢弃draft，不发PUT；previous只用于解释原值，不自动写回。' }],
  completion: '得到尚未写入的完整用户编辑草稿。',
  idempotency: null,
}))

add('setting-user-update', base({
  purpose: '按Portal编辑页提交规则保存一个已有用户的完整表单。',
  effect: 'write',
  inputs: { draft: param('prepareUpdate返回的完整用户表单草稿；不能只传差异字段。', 'setting-user-prepare-update.draft', { required: true, type: 'object' }) },
  output: { shape: 'undefined', fields: [field('$', 'undefined', 'PUT成功无业务返回值；失败抛错')], empty: '请求正常完成不等于字段已持久化，必须回到list/getInfo逐字段核对。' },
  consume: ['SDK发送PUT /sys/user，保留当前表单字段并强制useSystemList为[1,2,3,4,5,6]；不发送页面没有的password/salt。', '成功或超时后用getInfo或list按同一id回查username、realName、mobile、roleIdList及status等完整字段。'],
  steps: [{ role: 'required', when: 'PUT完成或响应超时', capabilityId: 'setting-user-get-info', instruction: '按同一id回查完整用户；不一致时报告未完成，超时不要盲目重复PUT。' }, { role: 'cancel', when: '用户在prepare阶段取消', instruction: '不调用update；已提交后没有Portal撤销接口，恢复必须由用户明确再次提交previous草稿。' }],
  completion: '请求未抛错且getInfo回查确认目标字段一致。',
  idempotency: '后端没有requestId；PUT通常是覆盖写，超时先getInfo核实，不能盲目重复提交。',
}))

add('setting-user-prepare-synchronous', base({
  purpose: '生成用户同步草稿；只在用户明确确认同步后才调用后端。',
  effect: 'prepare',
  inputs: {},
  output: { shape: '{ draft: { action: "setting-user-synchronous" } }', fields: [field('draft.action', 'string', '固定动作标识；只能交给setting-user-synchronous或cancelSynchronous。')], empty: '无网络副作用；固定返回同步草稿。' },
  consume: ['将draft展示为待确认操作；取消时调用cancel或直接丢弃，不发请求。'],
  steps: [
    { role: 'required', when: '用户明确确认同步', capabilityId: 'setting-user-synchronous', mapping: { draft: 'result.draft' }, instruction: '将同一份draft交给同步能力；不要自行添加请求体。' },
    { role: 'cancel', when: '用户取消同步', capabilityId: 'setting-user-cancel-synchronous', mapping: { draft: 'result.draft' }, instruction: '调用取消能力或丢弃draft；不发POST。' },
  ],
  completion: '得到可提交的同步草稿。',
  idempotency: null,
}))

add('setting-user-synchronous', base({
  purpose: '调用Portal用户列表定义的同步动作，触发服务端同步用户。',
  effect: 'write',
  inputs: { draft: param('prepareSynchronous返回的固定同步草稿；请求体为空。', 'settingUser.prepareSynchronous.result.draft', { required: true, type: '{ action: "setting-user-synchronous" }' }) },
  output: { shape: 'undefined', fields: [field('$', 'undefined', 'POST成功无业务返回值；失败抛错。')], empty: '成功只代表请求未抛错；服务端有60秒Redis节流，重复请求可能被拒绝。' },
  consume: ['发送POST /sys/user/synchronous且不带请求体；完成后重新调用setting-user-list或get-info核对同步结果。', '当前Portal源码中的actionSync函数未绑定可见按钮；调用方必须把它当作页面静态动作/后端支持能力，不声称当前列表按钮可见。'],
  steps: [{ role: 'required', when: '请求完成或响应不确定', capabilityId: 'setting-user-list', instruction: '重新读取列表或按组织范围核对同步结果；60秒内不要盲目重试。' }, { role: 'cancel', when: '用户在prepare阶段取消', capabilityId: 'setting-user-cancel-synchronous', instruction: '提交前可取消；请求已发出后Portal没有撤销接口。' }],
  completion: '请求未抛错且回查确认同步结果或明确记录服务端节流/权限结果。',
  idempotency: '后端以Redis 60秒节流控制重复同步；响应不确定时先回查并等待节流窗口，不要重复POST。',
}))

add('setting-user-cancel-synchronous', base({
  purpose: '取消尚未提交的用户同步草稿，不产生网络副作用。',
  effect: 'local',
  inputs: { draft: param('prepareSynchronous返回的固定同步草稿。', 'settingUser.prepareSynchronous.result.draft', { required: true, type: '{ action: "setting-user-synchronous" }' }) },
  output: { shape: '{ cancelled: true }', fields: [field('cancelled', 'boolean', '固定为true，表示本地草稿已取消。')], empty: '不发请求。' },
  consume: ['丢弃draft；需要再次同步时重新prepare。'],
  steps: [],
  completion: '返回cancelled=true且没有HTTP请求。',
  idempotency: null,
}))

export const SETTING_USER_AI_CONTRACTS = contracts
export const SETTING_USER_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_USER_METHODS).map(([id, method]) => [`settingUser.${method}`, { ...SETTING_USER_AI_CONTRACTS[id]!, boundaries: [...SETTING_USER_AI_CONTRACTS[id]!.boundaries, '直接方法使用单个对象参数；prepareUpdate的current/changes及update的draft结构见inputs。'] }]),
)
