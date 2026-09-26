import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { ME_PERSONAL_METHODS, mePersonalCapabilities } from '../capabilities/me-personal.js'

const definitions = new Map(mePersonalCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const boundaries = [
  '页面路径是/dashboard/me/personal/list，权限码是/dashboard/me/personal/list；请求使用platform实例并按Portal页面规则带module-type=11（组织管理）。这属于保留范围portal/hr的人力个人页面，不是独立生产系统。',
  '根页面只读取当前会话用户的员工资料；“编辑”按钮打开simple/hr/form/025的staff_info_change流程。SDK不把个人信息变更伪装成直接更新员工主表，也不扩展到人员管理页的通用员工CRUD。',
  '根页面的编辑按钮没有单独的按钮权限码，能看到页面即可看到按钮；流程表单路由的public白名单不等于后端授权。调用方必须使用当前会话userStore.state.staffId对应的员工ID，不能据此推断任意staffId都有权限。',
  '固定Java检出中的StaffInfoChangeController没有发现getRequiredStartUserSelectTasks的HTTP映射；Portal源码确实会在提交前POST该路径。SDK保留Portal真实请求并在契约中标记这一部署/源码不一致，不用另一个相似流程接口替代。',
]

const failures = [
  '会话、租户、页面权限、module-type、后端业务错误、网络错误和响应结构错误原样抛出；空数组只能表示当前员工没有该类明细，不能解释成无权限。',
  'prepare阶段的本地表单规则不通过时不发送审批人节点请求；submit阶段必须使用prepare返回的draft和tasks，并在写入前校验节点人数、重复用户和未知节点。',
  'create返回的是个人信息变更单ID，不代表员工主数据已经审批生效；成功或超时后必须用getChange或流程页回查状态，不能只凭HTTP成功提示完成。',
]

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@app/portal/views/dashboard/hr/me/personal/list.vue、app/portal/views/simple/hr/form/025/page/pc/edit/index.vue、app/portal/views/simple/hr/form/025/page/pc/detail/state.js（test/portal/main）',
    kind: 'reference',
    note: '逐页核对个人信息读取路径、编辑入口、formState展开提交、staffDuties/otherPosts逗号转换、学历字段白名单、无固定期限合同删除endTime、审批人节点请求和取消只返回流程列表。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java HrStaffController/HrStaffInfoDTO、StaffInfoChangeController、StaffInfoChangeSaveReqVO、StaffInfoChangeServiceImpl、StaffInfoChangeRespVO（test/test）',
    kind: 'reference',
    note: '核对员工详情字段、变更单create/get端点、create返回Long、变更审批状态和权限/数据范围的静态证据；固定源码未发现getRequiredStartUserSelectTasks映射。',
  },
  {
    source: 'src/capabilities/me-personal.ts 与 test/me-personal.test.ts',
    kind: 'implementation',
    note: '锁定URL、platform/module-type/page/permission、表单字段归一化、逐项校验、审批人节点人数规则、错误响应和反证；离线测试不替代真实环境权限矩阵与写入回查。',
  },
]

const detailFields: AiField[] = [
  field('id', 'string | number', '员工主键；根页面用它作为当前员工ID再次读取编辑表单'),
  field('staffId', 'string | number | null', '变更单或表单上下文中的员工ID；不能与变更单id混用', { optional: true, nullable: true, nullMeaning: '普通员工详情可能只返回id' }),
  field('name', 'string | null', '员工姓名；表单展示和提交快照', { nullable: true, nullMeaning: '后端未返回姓名' }),
  field('staffCode', 'string | number | null', '员工工号；展示字段，不是权限码', { nullable: true, nullMeaning: '未分配工号' }),
  field('idCard', 'string | null', '证件号码；个人信息表单字段，根页面只展示', { nullable: true, nullMeaning: '未填写或未返回' }),
  field('sex', 'number | null', '性别字典值；不要用显示名称替代', { nullable: true, nullMeaning: '未选择' }),
  field('birthday', 'string | null', '出生日期原值；Portal表单日期值通常为YYYY-MM-DD HH:mm:ss', { nullable: true, nullMeaning: '未填写' }),
  field('age', 'number | null', '年龄；Portal在修改birthday时按当前日期重算', { nullable: true, nullMeaning: '未返回或未计算' }),
  field('organization', 'string | number | null', '所属组织ID；不是组织名称', { nullable: true, nullMeaning: '未关联组织' }),
  field('post', 'string | number | null', '岗位ID；不是职务或组织ID', { nullable: true, nullMeaning: '未关联岗位' }),
  field('postName', 'string | null', '岗位名称', { nullable: true, nullMeaning: '后端未补充岗位名称' }),
  field('postTypeName', 'string | null', '岗位类型展示值；表单会在组织/岗位变化时清空它', { nullable: true, nullMeaning: '未返回' }),
  field('leader', 'string | number | null', '直属上级员工/用户关联ID', { nullable: true, nullMeaning: '未设置直属上级' }),
  field('entryTime', 'string | null', '入职日期；Portal修改后会按当前日期重算entrySeniority', { nullable: true, nullMeaning: '未填写' }),
  field('seniorityBeforeEntry', 'number | string | null', '入职前经历折算的月数；由工作经历起止月份汇总', { nullable: true, nullMeaning: '未返回' }),
  field('entrySeniority', 'number | string | null', '入职后司龄月数；由entryTime到当前日期按月计算', { nullable: true, nullMeaning: '未返回' }),
  field('totalSeniority', 'number | string | null', '总司龄；Portal表单按seniorityBeforeEntry + entrySeniority重算', { nullable: true, nullMeaning: '未返回' }),
  field('staffDuties', 'string | null', '职务ID逗号串；根页面展示为职务候选，提交前保持字符串而不是数组', { nullable: true, nullMeaning: '未设置职务' }),
  field('otherPosts', 'string | null', '其他岗位ID逗号串；提交前保持字符串而不是数组', { nullable: true, nullMeaning: '未设置其他岗位' }),
  field('otherPostsName', 'string | null', '其他岗位展示文本；不能反向当作提交ID', { nullable: true, nullMeaning: '未返回展示文本' }),
  field('mobile', 'string | number | null', '联系方式；根个人信息页展示为只读', { nullable: true, nullMeaning: '未填写' }),
  field('email', 'string | null', '邮箱；主表字段，没有页面显式必填规则', { nullable: true, nullMeaning: '未填写' }),
  field('emergencyContact', 'string | null', '紧急联系人；主表字段，没有页面显式必填规则', { nullable: true, nullMeaning: '未填写' }),
  field('relationship', 'number | string | null', '紧急联系人关系字典值', { nullable: true, nullMeaning: '未选择' }),
  field('emergencyMobile', 'string | number | null', '紧急联系人电话', { nullable: true, nullMeaning: '未填写' }),
  field('education', 'number | string | null', '最高学历字典值', { nullable: true, nullMeaning: '未选择' }),
  field('academicDegree', 'number | string | null', '最高学位字典值', { nullable: true, nullMeaning: '未选择' }),
  field('university', 'string | null', '全日制教育毕业院校', { nullable: true, nullMeaning: '未填写' }),
  field('speciality', 'string | null', '全日制教育所学专业', { nullable: true, nullMeaning: '未填写' }),
  field('workList', 'object[]', '工作经历数组；普通个人信息提交保留Portal返回的子项字段', { optional: true, nullable: true, nullMeaning: '后端未返回时表单按空数组处理' }),
  field('otherOrganizationList', 'object[]', '兼职组织数组；普通编辑把otherOrganizationInfoList映射到该字段后随表单提交', { optional: true, nullable: true, nullMeaning: '没有兼职组织' }),
  field('workList[].startTime', 'string | null', '工作开始时间', { optional: true, nullable: true, nullMeaning: '未填写' }),
  field('workList[].endTime', 'string | null', '工作结束时间', { optional: true, nullable: true, nullMeaning: '未填写' }),
  field('workList[].companyName', 'string | null', '公司名称；最多50字符且不能全为空格', { optional: true, nullable: true, nullMeaning: '未填写' }),
  field('workList[].department', 'string | null', '所在部门；最多50字符且不能全为空格', { optional: true, nullable: true, nullMeaning: '未填写' }),
  field('workList[].duties', 'string | null', '担任职务；最多50字符且不能全为空格', { optional: true, nullable: true, nullMeaning: '未填写' }),
  field('workList[].salaryRange', 'string | null', '薪酬范围；最多50字符且不能全为空格', { optional: true, nullable: true, nullMeaning: '未填写' }),
  field('workList[].description', 'string | null', '工作描述；最多200字符且不能全为空格', { optional: true, nullable: true, nullMeaning: '未填写' }),
  field('workList[].leaveReason', 'string | null', '离职原因；最多200字符且不能全为空格', { optional: true, nullable: true, nullMeaning: '未填写' }),
  field('educationalList', 'object[]', '学历经历数组；提交时每项只保留Portal的固定18个字段', { optional: true, nullable: true, nullMeaning: '没有学历经历' }),
  field('educationalList[].school', 'string', '毕业院校；必填、最多50字符且不能全为空格'),
  field('educationalList[].speciality', 'string', '所学专业；必填、最多50字符且不能全为空格'),
  field('educationalList[].educationalSystem', 'string | null', '学制；最多50字符且不能全为空格', { optional: true, nullable: true, nullMeaning: '未填写' }),
  field('educationalList[].learningStyle', 'string | null', '学习方式；最多50字符且不能全为空格', { optional: true, nullable: true, nullMeaning: '未填写' }),
  field('educationalList[].degreeFile', 'string | null', '学历附件URL/值', { optional: true, nullable: true, nullMeaning: '无附件' }),
  field('educationalList[].academicDegreeFile', 'string | null', '学位附件URL/值', { optional: true, nullable: true, nullMeaning: '无附件' }),
  field('familyList', 'object[]', '家庭情况数组；name/duties/mobile/unit/education/remark遵循页面长度和非全空格规则', { optional: true, nullable: true, nullMeaning: '没有家庭情况' }),
  field('familyList[].age', 'integer | null', '家人年龄；填写时必须是precision=0且最小为1的整数', { optional: true, nullable: true, nullMeaning: '未填写' }),
  field('professionalList', 'object[]', '职业资格数组；code非空时只能数字和字母', { optional: true, nullable: true, nullMeaning: '没有职业资格' }),
  field('positionalList', 'object[]', '职称信息数组；code非空时只能数字和字母，remark在Portal没有rules', { optional: true, nullable: true, nullMeaning: '没有职称信息' }),
  field('contractList', 'object[]', '合同信息数组；termType=2（无固定期限）时提交前删除endTime', { optional: true, nullable: true, nullMeaning: '没有合同信息' }),
  field('status', 'number | string | null', '变更单流程状态；在getChange响应中用于判断审批状态', { optional: true, nullable: true, nullMeaning: '普通员工详情没有该状态' }),
  field('processInstanceId', 'string | null', '变更流程实例ID；用于流程回查，不是业务变更单ID', { optional: true, nullable: true, nullMeaning: '尚未生成或响应未返回' }),
]

const taskFields: AiField[] = [
  field('$', 'object[]', '后端返回的发起人自选审批节点数组'),
  field('[].id', 'string', 'BPM节点ID；startUserSelectAssignees的键必须来自这里'),
  field('[].name', 'string | null', '节点名称；用于向用户解释需要选择谁', { optional: true, nullable: true, nullMeaning: '后端未返回名称' }),
  field('[].minSelectCount', 'integer | null', '最少选择人数', { optional: true, nullable: true, nullMeaning: '无最少人数限制' }),
  field('[].maxSelectCount', 'integer | null', '最多选择人数', { optional: true, nullable: true, nullMeaning: '无最多人数限制' }),
  field('[].selectionOrderRequired', 'boolean | null', '是否要求保留选择顺序', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
]

const draftFields: AiField[] = [
  field('draft', 'object', '按Portal普通编辑表单构造的完整变更草稿；保留主表字段和工作/家庭/职业/职称/合同列表'),
  field('draft.staffId', 'string | number', '员工ID；来自current.id或current.staffId'),
  field('draft.staffDuties', 'string', '数组按逗号连接后的职务ID字符串；空数组变为空字符串'),
  field('draft.otherPosts', 'string', '数组按逗号连接后的其他岗位ID字符串；空数组变为空字符串'),
  field('draft.educationalList', 'object[]', '每项只保留Portal EDUCATIONAL_ITEM_FIELDS，缺失字段补null'),
  field('draft.contractList', 'object[]', 'Portal合同列表副本；termType=2时不含endTime'),
  field('draft.otherOrganizationList', 'object[]', '普通编辑从current.otherOrganizationInfoList映射出的兼职组织列表；用户显式传入otherOrganizationList时保留其编辑结果', { optional: true, nullable: true, nullMeaning: '没有兼职组织' }),
  field('draft.seniorityBeforeEntry', 'number', 'Portal表单初始化时Number(result.seniorityBeforeEntry) || 0后的入职前工龄'),
  field('draft.entrySeniority', 'number', 'Portal表单初始化时Number(result.entrySeniority) || 0后的司龄'),
  field('draft.totalSeniority', 'number', '按Portal watchEffect用seniorityBeforeEntry + entrySeniority重算的总司龄'),
]

const outputObject = (name: string): AiContract['output'] => ({
  shape: 'object',
  fields: detailFields,
  empty: `${name}响应不是对象或缺少有效ID时抛错；不要用空对象继续编辑或提交。`,
})

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作Portal「个人信息」页面的读取、编辑入口和员工信息变更流程。',
  boundaries,
  prerequisites: ['使用当前用户会话、当前租户，并拥有Portal“个人信息”页面权限；staffId必须来自当前会话员工身份。'],
  failures,
  evidence,
  gaps: ['已完成Portal/Java逐页源码核对和离线请求断言；尚未在真实测试环境执行当前用户/无权限/跨员工staffId矩阵、读取冒烟或真实prepare→submit→流程回查。', '固定Java源码未发现getRequiredStartUserSelectTasks映射；需在目标部署环境确认Portal该前置请求是否由网关或其他模块提供。'],
})

const contracts: Record<string, AiContract> = {}
function add (id: string, contract: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Me personal contract has no registered definition: ${id}`)
  contracts[id] = contract
}

add('me-personal-get', base({
  purpose: '读取当前会话用户自己的个人信息详情，供根页面展示和编辑表单初始化。',
  effect: 'read',
  inputs: { staffId: param('当前会话用户的员工ID；不要使用任意员工列表中的ID替代。', 'Portal userStore.state.staffId；也可由当前会话的用户基础数据取得', { type: 'string | number', required: true, constraints: ['必须为正整数'] }) },
  output: outputObject('个人信息'),
  consume: ['使用result.id作为prepare.current的当前员工详情；保留workList/familyList/professionalList/positionalList/contractList完整子项。', 'staffDuties和otherPosts在读取结果中是逗号分隔字符串；展示时可拆成候选ID数组，但提交前必须交回逗号字符串。'],
  steps: [{ role: 'optional', when: '用户点击个人信息页“编辑”', capabilityId: 'me-personal-prepare-edit', instruction: '先取得与Portal一致的simple/hr/form/025编辑入口，再用本次详情准备提交草稿。' }, { role: 'optional', when: '用户要修改资料', capabilityId: 'me-personal-prepare', mapping: { current: 'result.$' }, instruction: '只把用户明确修改的字段作为changes传入；不要以显示名称覆盖ID字段。' }],
  completion: '获得当前员工主数据详情；这只是读取，不代表拥有提交变更或审批权限。',
  idempotency: null,
}))

add('me-personal-prepare-edit', base({
  purpose: '准备根页面“编辑”按钮打开的个人信息流程表单路由参数。',
  effect: 'local',
  inputs: {},
  output: {
    shape: '{ path: string, processKey: string, bpmMode: string }',
    fields: [
      field('path', 'string', 'simple/hr/form/025；Portal openFlowFormByPath的表单路径'),
      field('processKey', 'string', 'staff_info_change；Java流程构建器使用的流程定义key'),
      field('bpmMode', 'string', '固定为edit；与Portal编辑入口一致'),
    ],
    empty: '固定路由常量不会为空；返回值只用于导航，不代表表单已读取或已提交。',
  },
  consume: ['打开该路由后仍需先get个人员工详情；路由参数准备不会绕过页面权限或后端流程授权。'],
  steps: [],
  completion: '得到与Portal编辑按钮相同的表单路径和模式；尚未产生网络请求或写入。',
  idempotency: null,
}))

add('me-personal-prepare', base({
  purpose: '按Portal个人信息编辑表单的校验和字段投影构造变更草稿，并调用Portal提交前审批人节点接口。',
  effect: 'prepare',
  inputs: {
    current: param('mePersonal.get返回的完整员工详情；必须包含id或staffId。', 'me-personal-get.result', { type: 'object', required: true }),
    changes: param('用户明确修改的表单字段；未提供的字段沿用current，不能用显示文本代替ID。', '用户编辑意图', { type: 'object', required: false, nullable: true }),
  },
  output: { shape: '{ draft: object, tasks: object[] }', fields: [...draftFields, ...taskFields.map(item => ({ ...item, path: item.path === '$' ? 'tasks' : `tasks${item.path}` }))], empty: '表单字段不符合Portal规则时在本地抛错且不发审批人节点请求；tasks=[]表示服务端判定本次不需要人工选审批人。' },
  consume: [
    '普通编辑的请求体来自“...formState”：主表字段和workList/familyList/professionalList/positionalList按原样保留；educationalList每项只保留startTime、endTime、school、speciality、degree、academicDegree、educationalSystem、learningStyle、isFullTime、isUnifiedRecruitment、isHighestDegree、isFirstDegree、degreeFile、academicDegreeFile、educationType、havingRentalSubsidies、rentalFile。',
    'staffDuties和otherPosts支持页面数组/已有逗号字符串，提交草稿中统一为逗号字符串；contractList的termType=2时删除endTime；undefined最终按Portal create请求的transformUndefinedToNull语义变成null。',
    '显式表单规则仅覆盖学历院校/专业必填、各嵌套文本长度与非全空格、家庭年龄整数最小1、职业资格/职称证书编号非空时只允许数字和字母；主表标签没有显式rules的字段不能被SDK擅自增加必填校验。',
  ],
  steps: [{ role: 'required', when: '用户确认保存且已完成审批人选择', capabilityId: 'me-personal-submit', mapping: { draft: 'result.draft', tasks: 'result.tasks' }, instruction: '把tasks按节点ID映射为startUserSelectAssignees后提交；不要跳过prepare直接猜审批人。' }, { role: 'cancel', when: '用户点击个人信息编辑页取消', instruction: '丢弃draft和tasks；Portal的取消只调用goBack，不发取消或删除HTTP请求。' }],
  completion: '得到尚未落库的完整变更草稿和本次流程需要的审批人节点；prepare本身不写业务数据。',
  idempotency: null,
}))

add('me-personal-submit', base({
  purpose: '提交一个已按Portal规则准备、并完成审批人节点选择的个人信息变更单。',
  effect: 'write',
  inputs: {
    draft: param('mePersonal.prepare返回的draft；不要手工删掉主表字段或子列表字段。', 'me-personal-prepare.draft', { type: 'object', required: true }),
    tasks: param('同一次prepare返回的tasks；不能用另一次提交的节点数组。', 'me-personal-prepare.tasks', { type: 'object[]', required: true }),
    startUserSelectAssignees: param('每个审批节点ID对应的用户ID数组；没有节点时传{}，有minSelectCount时必须满足人数且不能重复。', '用户在审批人候选中选择的结果', { type: 'object', required: false, nullable: true, omitted: '无节点时使用{}' }),
  },
  output: { shape: 'string | number', fields: [field('$', 'string | number', '新建的个人信息变更单业务ID；不是员工ID，也不是流程实例ID')], empty: '响应不是正整数ID时抛错；不能把true、空对象或HTTP成功当作变更已生效。' },
  consume: [
    '请求顺序与Portal一致：prepare阶段POST /hr/staff-info-change/getRequiredStartUserSelectTasks，submit阶段POST /hr/staff-info-change/create，create body为{...draft,startUserSelectAssignees}且审批人字段在最后。',
    'Java服务会把变更单置为SUBMITTED并启动staff_info_change审批；员工主数据通常要审批完成后才体现。',
  ],
  steps: [{ role: 'required', when: 'POST成功或响应超时', capabilityId: 'me-personal-change-get', mapping: { id: 'result.$' }, instruction: '读取同一变更单并核对staffId、提交字段、status和processInstanceId；超时未回查前不要盲目重发。' }, { role: 'cancel', when: '用户在prepare阶段取消', instruction: '不调用create；已提交后的服务端撤回不属于个人信息根页面的可达按钮，应转到Portal流程/待办页面的对应能力。' }],
  completion: '仅当getChange或流程页面回查确认变更单已创建并处于预期状态，才能向用户报告提交受理；这不等于员工主数据已经审批生效。',
  idempotency: '后端没有requestId；响应超时先用业务ID或流程列表回查，未确认前不重发。重复提交还可能触发同一员工已有审批中变更的业务冲突。',
}))

add('me-personal-change-get', base({
  purpose: '读取个人信息变更单详情，用于提交后的业务回查，或Portal表单025的驳回/重新发起详情初始化。',
  effect: 'read',
  inputs: { id: param('个人信息变更单ID；不要传员工ID。', 'me-personal-submit.$ 或Portal流程businessKey', { type: 'string | number', required: true, constraints: ['必须为正整数'] }) },
  output: outputObject('个人信息变更单'),
  consume: ['核对id与staffId的归属、status和processInstanceId；status表示变更流程状态，不要把它当员工在职状态。', '回查仍返回变更单快照时，不要误认为员工主数据已经更新；审批结束后再用mePersonal.get读取主表。'],
  steps: [{ role: 'recovery', when: '变更单审批完成且需要确认个人主数据已生效', capabilityId: 'me-personal-get', mapping: { staffId: 'result.staffId' }, instruction: '再读取员工主表，逐字段核对最终生效值。' }],
  completion: '获得变更单快照和流程状态；读取本身不改变审批状态。',
  idempotency: null,
}))

export const ME_PERSONAL_AI_CONTRACTS: Record<string, AiContract> = contracts
export const ME_PERSONAL_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(ME_PERSONAL_METHODS).map(([capabilityId, method]) => [
    `mePersonal.${method}`,
    {
      ...ME_PERSONAL_AI_CONTRACTS[capabilityId]!,
      boundaries: [...ME_PERSONAL_AI_CONTRACTS[capabilityId]!.boundaries, `直接方法使用sdk.mePersonal.${method}；submit仍必须先按契约prepare再回查。`],
    },
  ]),
)
