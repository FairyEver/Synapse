import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { hrExternalStaffCapabilities, HR_EXTERNAL_STAFF_METHODS } from '../capabilities/hr-external-staff.js'

const definitions = new Map(hrExternalStaffCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const staffFields: AiField[] = [
  field('id', 'string | number', '外部员工主键；Long 可能序列化为字符串，编辑和删除必须使用它'),
  field('organization', 'string | number | null', '所属组织ID；null 表示未选择组织', { nullable: true, nullMeaning: '未关联组织' }),
  field('name', 'string | null', '姓名；表单必填且最多10个字符', { nullable: true, nullMeaning: '后端未返回姓名' }),
  field('idType', 'integer | null', '证件类型字典值；表单必填', { nullable: true, nullMeaning: '未选择证件类型' }),
  field('idCard', 'string | null', '证件号码；表单必填，最多20个字符且只能数字和字母', { nullable: true, nullMeaning: '未填写证件号码' }),
  field('birthday', 'string | number | null', '出生日期；Portal格式YYYY-MM-DD HH:mm:ss', { nullable: true, nullMeaning: '未填写出生日期' }),
  field('sex', 'integer | null', '性别字典值；表单必填', { nullable: true, nullMeaning: '未选择性别' }),
  field('mobile', 'string | number | null', '联系方式；表单必填且不能全为空格；后端DTO为Long', { nullable: true, nullMeaning: '未填写联系方式' }),
  field('nation', 'string | null', '民族字典值', { nullable: true, nullMeaning: '未选择民族' }),
  field('staffCode', 'string | number | null', '员工号；后端新建时由mobile设置', { nullable: true, nullMeaning: '后端未返回员工号' }),
  field('nativePlace', 'string | null', '籍贯', { nullable: true, nullMeaning: '未填写籍贯' }),
  field('isDel', 'integer | null', '逻辑删除标记；列表查询只返回0', { nullable: true, nullMeaning: '响应未带删除标记' }),
  field('householdType', 'integer | null', '户口性质字典值', { nullable: true, nullMeaning: '未选择户口性质' }),
  field('residenceAddress', 'string | null', '户籍地址', { nullable: true, nullMeaning: '未填写户籍地址' }),
  field('address', 'string | null', '现住址', { nullable: true, nullMeaning: '未填写现住址' }),
  field('politicalOutlook', 'integer | null', '政治面貌字典值', { nullable: true, nullMeaning: '未选择政治面貌' }),
  field('communistTime', 'string | number | null', '入党团日期；Portal格式YYYY-MM-DD HH:mm:ss', { nullable: true, nullMeaning: '未填写日期' }),
  field('education', 'integer | null', '最高学历字典值', { nullable: true, nullMeaning: '未选择学历' }),
  field('academicDegree', 'integer | null', '学位字典值', { nullable: true, nullMeaning: '未选择学位' }),
  field('isFullTime', 'integer | null', '是否全日制字典值', { nullable: true, nullMeaning: '未选择是否全日制' }),
  field('enrollmentDate', 'string | number | null', '入学日期；当前页面不展示，保留后端字段', { nullable: true, nullMeaning: '响应未返回' }),
  field('graduationTime', 'string | number | null', '毕业时间；当前页面不展示，保留后端字段', { nullable: true, nullMeaning: '响应未返回' }),
  field('university', 'string | null', '全日制教育毕业院校', { nullable: true, nullMeaning: '未填写' }),
  field('speciality', 'string | null', '全日制教育所学专业', { nullable: true, nullMeaning: '未填写' }),
  field('creator', 'string | number | null', '创建人ID', { nullable: true, nullMeaning: '响应未返回' }),
  field('createTime', 'string | number | null', '创建时间原值；SDK不做时区转换', { nullable: true, nullMeaning: '响应未返回' }),
  field('updater', 'string | number | null', '修改人ID', { nullable: true, nullMeaning: '响应未返回' }),
  field('updateTime', 'string | number | null', '修改时间原值；SDK不做时区转换', { nullable: true, nullMeaning: '响应未返回' }),
  field('educationUniversity', 'string | null', '在职教育毕业院校', { nullable: true, nullMeaning: '未填写' }),
  field('educationSpeciality', 'string | null', '在职教育所学专业', { nullable: true, nullMeaning: '未填写' }),
  field('outstandingAchievement', 'string | null', '主要业绩', { nullable: true, nullMeaning: '未填写' }),
  field('expertise', 'string | null', '熟悉专业有何专长', { nullable: true, nullMeaning: '未填写' }),
  field('awards', 'string | null', '获奖情况', { nullable: true, nullMeaning: '未填写' }),
  field('appointmentFirm', 'string | null', '任职公司名称（股、董、监）；表单必填且最多30个字符', { nullable: true, nullMeaning: '未填写' }),
  field('appointmentPost', 'string | null', '任职岗位名称（股、董、监）；表单必填且最多10个字符', { nullable: true, nullMeaning: '未填写' }),
  field('appointmentTime', 'string | number | null', '任职时间（股、董、监）；表单必填', { nullable: true, nullMeaning: '未填写' }),
  field('appointmentFirmExecutives', 'string | null', '任职公司名称（高管）', { nullable: true, nullMeaning: '未填写' }),
  field('appointmentPostExecutives', 'string | null', '任职岗位名称（高管）', { nullable: true, nullMeaning: '未填写' }),
  field('appointmentTimeExecutives', 'string | number | null', '任职时间（高管）', { nullable: true, nullMeaning: '未填写' }),
  field('tenantId', 'string | number | null', '租户ID；由当前会话决定，不能用它切换租户', { nullable: true, nullMeaning: '响应未返回' }),
  field('studyPost', 'string | null', '学业技术职务', { nullable: true, nullMeaning: '未填写' }),
  field('fullPath', 'string | null', '所属组织全路径；列表由组织表关联返回', { nullable: true, nullMeaning: '组织路径未返回' }),
]

const staffOutput: AiContract['output'] = {
  shape: 'object',
  fields: staffFields,
  empty: '详情响应不是对象或缺少有效id会抛错；不能把空对象当作可编辑表单。',
}

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('list', 'object[]', '当前页外部员工记录'),
    field('total', 'number', '符合筛选条件的总记录数，不是当前页长度'),
    ...staffFields.map(item => ({ ...item, path: `list[].${item.path}` })),
  ],
  empty: 'list=[] 且 total=0 表示当前筛选没有记录；权限、网络或响应形状错误会抛出。',
}

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', 'Portal成功包络没有业务返回值；Promise正常完成只表示请求完成')],
  empty: '写请求成功没有业务数据；必须按契约步骤回查列表或详情确认结果。',
}

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/hr.js、app/portal/views/dashboard/hr/staff/external-staff-list.vue、list.vue、[mode]/[id].vue @ bbcfc35154', kind: 'reference', note: '证明菜单权限、module-type页面、查询字段、删除选择条件、表单规则、请求体和敏感操作入口。' },
  { source: 'HrOutsideStaffController、HrOutsideStaffDTO、HrOutsideStaffSelectDTO、HrOutsideStaffServiceImpl、HrOutsideStaffDao.xml @ b7a359adc9e', kind: 'reference', note: '证明page/get/POST/PUT/DELETE端点、DTO字段、手机号导致staffCode变化、逻辑删除和组织筛选SQL。' },
  { source: 'src/capabilities/hr-external-staff.ts 与 test/hr-external-staff.test.ts', kind: 'implementation', note: '证明SDK请求形状、表单投影、负例、敏感短信链和AI说明结构；不替代真实环境写回查。' },
]

const contracts: Record<string, AiContract> = {}

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「外部员工」列表及其新建、编辑、删除入口。',
  boundaries: [
    '页面权限是/dashboard/staff/external-staff-list；请求使用platform实例，页面路径按Portal规则携带module-type=11（组织管理）。',
    '列表声明了exportURL，但模板没有导出按钮，SDK不发布导出能力；不能把声明配置当成可达动作。',
    '模板声明批量删除，但复选框仅允许record.status===2，而HrOutsideStaffDTO没有status字段；当前Java响应下批量选择不可达。SDK仍按后端DELETE数组形状接收ids，页面行删除传单个ID。',
    '删除前按Portal全局敏感操作配置决定是否发送短信验证码；SDK不会绕过验证码要求，也不把短信requestId当幂等键。',
  ],
  prerequisites: ['使用当前用户会话token、当前租户和人力组织权限创建SDK；组织ID、员工ID必须来自当前租户可见数据。'],
  failures: ['表单校验、敏感配置、短信校验、权限、手机号重复、组织范围、网络或响应形状错误原样抛出；空列表不解释为权限失败。'],
  evidence,
  gaps: ['已完成Portal/Java逐页静态核对和离线请求断言；尚未在真实测试环境执行本页浏览器读请求，也未执行真实创建/编辑/敏感删除的prepare→submit→回查闭环。'],
})

const queryInputs: Record<string, AiParameter> = {
  name: param('姓名包含筛选；省略或空字符串表示不筛选。', 'Portal姓名输入框', { type: 'string', required: false, omitted: '发送空字符串' }),
  mobile: param('联系方式筛选；Portal按输入框原值发送，省略或空字符串表示不筛选。', 'Portal手机号输入框', { type: 'string | number', required: false, omitted: '发送空字符串' }),
  orgId: param('组织ID筛选；不是组织名称，省略或空字符串表示不筛选。', 'Portal组织树选择器', { type: 'string | number', required: false, nullable: true, omitted: '发送空字符串' }),
  pageNo: param('从1开始的页码。', 'Portal分页状态', { type: 'number', required: false, omitted: '使用1' }),
  pageSize: param('每页条数。', 'Portal分页状态', { type: 'number', required: false, omitted: '使用20', constraints: ['只能是10、20、50或100'] }),
}

function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`External staff contract has no definition: ${id}`)
  contracts[id] = value
}

add('hr-external-staff-list', base({
  purpose: '按姓名、联系方式和组织筛选读取当前用户可见的外部员工分页。',
  effect: 'read',
  inputs: queryInputs,
  output: listOutput,
  consume: ['按total和分页状态继续翻页；保留list[].id作为编辑或删除目标。', '列表fullPath、证件类型、性别和任职字段用于展示；列表没有导出动作。'],
  steps: [{ role: 'optional', when: '用户选择新建', capabilityId: 'hr-external-staff-prepare-create', instruction: '按表单必填和格式规则生成草稿；取消时丢弃草稿。' }, { role: 'optional', when: '用户选择编辑', capabilityId: 'hr-external-staff-get', mapping: { id: 'result.list[].id' }, instruction: '先读取详情，不要只用列表字段覆盖保存。' }],
  completion: '返回当前筛选的一页和total；读取成功不等于具有写权限。',
  idempotency: null,
}))

add('hr-external-staff-get', base({
  purpose: '读取一个外部员工的完整编辑表单值。',
  effect: 'read',
  inputs: { id: param('外部员工主键。', 'hr-external-staff-list.list[].id', { type: 'string | number', required: true }) },
  output: staffOutput,
  consume: ['保存完整详情作为prepareUpdate.current；日期保留Portal字符串，不能把Long ID改成显示名称。'],
  steps: [{ role: 'optional', when: '用户确认编辑', capabilityId: 'hr-external-staff-prepare-update', mapping: { current: 'result.$' }, instruction: '只覆盖用户明确修改的表单字段。' }],
  completion: '获得与Portal customLoad相同的员工对象。',
  idempotency: null,
}))

const formInput: AiParameter = { type: 'object', required: true, meaning: 'Portal外部员工表单字段；至少填写Portal必填字段并遵守长度、空格、日期和证件号码规则。', source: '用户明确提供的外部员工资料；字段语义见form.*返回说明。' }
const draftOutput = (name: string): AiContract['output'] => ({ shape: 'object', fields: [field('draft', 'object', `${name}请求体；保存时按Portal字段原样提交`), ...staffFields.map(item => ({ ...item, path: `draft.${item.path}` }))], empty: '必填字段缺失或格式错误会在准备阶段抛错，不生成半成品草稿。' })

add('hr-external-staff-prepare-create', base({
  purpose: '按Portal新建表单规则校验资料并生成新建草稿。',
  effect: 'prepare',
  inputs: { form: formInput },
  output: draftOutput('新建'),
  consume: ['提交前必须确认appointmentFirm、appointmentPost、appointmentTime、name、idType、idCard、birthday、sex、mobile均已填写；idCard只能数字和字母，日期使用YYYY-MM-DD HH:mm:ss。', '取消时丢弃draft，不调用create。'],
  steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'hr-external-staff-create', mapping: { draft: 'result.draft' }, instruction: '只提交准备结果；成功后回到list按姓名、组织和ID回查。' }, { role: 'cancel', when: '用户取消新建', instruction: '丢弃draft，不发POST。' }],
  completion: '得到尚未写入的外部员工新建草稿。',
  idempotency: null,
}))

add('hr-external-staff-create', base({
  purpose: '提交一个通过Portal表单校验的外部员工新建草稿。',
  effect: 'write',
  inputs: { draft: param('prepareCreate返回的完整新建草稿。', 'hr-external-staff-prepare-create.draft', { type: 'object', required: true }) },
  output: voidOutput,
  consume: ['发送POST /org/outsideStaff；Portal和Java服务会用mobile检查重复，并在成功新建时把staffCode设置为mobile。', '成功或超时后用list/get按姓名、mobile和组织回查；不能只看Promise完成。'],
  steps: [{ role: 'required', when: 'POST完成或响应超时', capabilityId: 'hr-external-staff-list', instruction: '回查列表确认记录出现并核对mobile、staffCode、organization；未确认前不要盲目重发。' }],
  completion: '请求未抛错且列表/详情回查确认员工已出现。',
  idempotency: '后端没有requestId；新建超时可能已经写入，先按mobile和姓名回查，确认不存在后才能再次提交。',
}))

add('hr-external-staff-prepare-update', base({
  purpose: '基于最新详情和用户明确修改生成完整编辑草稿。',
  effect: 'prepare',
  inputs: { current: param('最新get返回的完整外部员工对象。', 'hr-external-staff-get', { type: 'object', required: true }), changes: param('只覆盖Portal表单字段；未修改字段保留current原值。', '用户明确编辑意图', { type: 'object', required: false, nullable: true }) },
  output: { shape: '{ draft: object, previous: object }', fields: [field('draft', 'object', 'PUT /org/outsideStaff要发送的完整表单和后端字段'), field('previous', 'object', '提交前完整表单值；取消时只丢弃draft')], empty: 'current缺少id或Portal必填字段不符合规则会抛错。' },
  consume: ['编辑手机号时如果改动，后端会重新按mobile检查重复并把staffCode改成新mobile；SDK不擅自调用未存在的手机号检查接口。', '编辑页自定义提交使用transformUndefinedToNull=true；准备结果不包含undefined表单字段。'],
  steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'hr-external-staff-update', mapping: { draft: 'result.draft' }, instruction: '只提交draft；成功后回查详情。' }, { role: 'cancel', when: '用户点击取消', instruction: '丢弃draft，不发PUT；previous不自动写回。' }],
  completion: '得到尚未写入的完整编辑草稿。',
  idempotency: null,
}))

add('hr-external-staff-update', base({
  purpose: '提交一个通过Portal编辑表单校验的外部员工完整草稿。',
  effect: 'write',
  inputs: { draft: param('prepareUpdate返回的完整草稿，必须包含id和表单必填字段。', 'hr-external-staff-prepare-update.draft', { type: 'object', required: true }) },
  output: voidOutput,
  consume: ['发送PUT /org/outsideStaff；后端手机号重复时返回业务失败，SDK原样抛出。', '成功或超时后用get按同一id回查name、mobile、staffCode、organization及所有受影响字段。'],
  steps: [{ role: 'required', when: 'PUT完成或响应超时', capabilityId: 'hr-external-staff-get', mapping: { id: 'args.draft' }, instruction: '从已提交draft取同一id逐字段回查确认终态；不一致或超时未确认时不要盲目重复PUT。' }],
  completion: '请求未抛错且详情回查确认目标字段一致。',
  idempotency: '后端没有requestId；PUT通常是覆盖写，超时先get回查。',
}))

add('hr-external-staff-prepare-remove', base({
  purpose: '校验删除ID并读取Portal全局敏感操作配置。',
  effect: 'prepare',
  inputs: { ids: param('要删除的外部员工ID数组；当前页面行删除传单个ID。', 'hr-external-staff-list.list[].id', { type: 'string[] | number[]', required: true }) },
  output: { shape: '{ ids: (string | number)[], verificationRequired: boolean, phone: string | null }', fields: [field('ids', 'array', '去重后的待删除ID数组'), field('verificationRequired', 'boolean', '敏感配置未关闭且配置非空时为true'), field('phone', 'string | null', '敏感配置中的接收手机号；只用于发送验证码', { nullable: true, nullMeaning: '无需验证或未配置手机号' })], empty: 'ids为空或ID非法会在发敏感配置请求前失败。' },
  consume: ['verificationRequired=false且用户确认时可直接remove；为true时先sendDeleteCode并由真人提供验证码。', '取消时不调用remove，prepare本身不删除员工。'],
  steps: [{ role: 'required', when: 'verificationRequired=true且用户确认发送验证码', capabilityId: 'hr-external-staff-send-delete-code', mapping: { ids: 'result.ids' }, instruction: '固定发送到敏感配置手机号，不能替换收件人。' }, { role: 'optional', when: 'verificationRequired=false且用户确认删除', capabilityId: 'hr-external-staff-remove', mapping: { ids: 'result.ids' }, instruction: '直接提交删除；仍需回查列表确认记录消失。' }, { role: 'cancel', when: '用户取消删除', instruction: '不调用sendDeleteCode或remove。' }],
  completion: '得到删除ID和是否需要短信验证的准备结果。',
  idempotency: null,
}))

add('hr-external-staff-send-delete-code', base({
  purpose: '在敏感配置要求二次验证时向配置手机号发送外部员工删除验证码。',
  effect: 'write',
  inputs: { ids: param('同prepareRemove返回的待删除ID数组。', 'hr-external-staff-prepare-remove.ids', { type: 'array', required: true }) },
  output: { shape: '{ smsRequestId: string }', fields: [field('smsRequestId', 'string', '本次短信校验requestId；不是删除幂等键')], empty: '短信响应缺少requestId会抛错且不会自动重发。' },
  consume: ['只在prepareRemove.verificationRequired=true且用户确认发送时调用；短信收件人为敏感配置手机号，templateId固定17709。', '把smsRequestId和用户收到的验证码交给remove；不要记录验证码。'],
  steps: [{ role: 'required', when: '用户收到验证码并确认删除', capabilityId: 'hr-external-staff-remove', mapping: { ids: 'input.ids', smsRequestId: 'result.smsRequestId' }, instruction: 'code必须由真人提供，不能猜测或复用旧验证码。' }],
  completion: '返回本次短信校验requestId。',
  idempotency: '短信发送没有幂等键；响应不确定时先确认短信和requestId，不自动重发。',
}))

add('hr-external-staff-remove', base({
  purpose: '按Portal敏感操作规则逻辑删除外部员工。',
  effect: 'write',
  inputs: { ids: param('待删除外部员工ID数组。', 'hr-external-staff-prepare-remove.ids', { type: 'array', required: true }), smsRequestId: param('敏感保护开启时的短信requestId。', 'hr-external-staff-send-delete-code.smsRequestId', { type: 'string', required: false }), code: param('敏感保护开启时由手机号持有人提供的验证码。', '用户输入；不要猜测或记录', { type: 'string', required: false }) },
  output: voidOutput,
  consume: ['SDK会重新读取敏感配置；需要短信验证码时先GET /sys/sms/checkSms，再DELETE /org/outsideStaff，body始终是ID数组。', '成功或超时后用list确认记录不再出现；不要只用详情接口判断，因为后端是逻辑删除。'],
  steps: [{ role: 'required', when: 'DELETE完成或响应超时', capabilityId: 'hr-external-staff-list', instruction: '按同一筛选和ID回查列表；未确认前不要重复删除。' }],
  completion: '请求未抛错且列表回查确认目标ID已不可见。',
  idempotency: '后端没有requestId；逻辑删除超时先回查列表，短信requestId只用于验证码校验。',
}))

export const HR_EXTERNAL_STAFF_AI_CONTRACTS = contracts
export const HR_EXTERNAL_STAFF_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(HR_EXTERNAL_STAFF_METHODS).map(([id, method]) => [`hrExternalStaff.${method}`, { ...HR_EXTERNAL_STAFF_AI_CONTRACTS[id]!, boundaries: [...HR_EXTERNAL_STAFF_AI_CONTRACTS[id]!.boundaries, '直接方法使用单个对象参数；新建/编辑/删除的准备、验证码与草稿结构见inputs和steps。'] }]),
)
