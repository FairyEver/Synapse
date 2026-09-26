import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { RECRUITMENT_PLAN_METHODS, recruitmentPlanCapabilities } from '../capabilities/recruitment-plan.js'

const definitions = new Map(recruitmentPlanCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const planFields: AiField[] = [
  field('id', 'string | number', '招聘计划主键；Java Long可能序列化为字符串，原样保留，用于详情、编辑、简历和删除', { optional: true }),
  field('title', 'string | null', '后端生成的列表标题；不作为提交字段', { optional: true, nullable: true, nullMeaning: '后端未返回标题' }),
  field('recruitmentType', '1 | 2', '招聘类型：1计划内、2计划外', { optional: true, nullable: true, values: { '1': '计划内', '2': '计划外' } }),
  field('recruitmentTypeName', 'string | null', '招聘类型显示名称', { optional: true, nullable: true, nullMeaning: '后端未返回显示名称' }),
  field('planYear', 'number | null', '招聘计划年度；表单要求不早于当前年份', { optional: true, nullable: true, nullMeaning: '后端未返回年度' }),
  field('organizationId', 'string | number | null', '招聘组织ID；来自角色组织树', { optional: true, nullable: true, nullMeaning: '未绑定组织' }),
  field('organizationName', 'string | null', '提交时保存的组织名称快照', { optional: true, nullable: true, nullMeaning: '未保存组织名称' }),
  field('organizationFullPath', 'string | null', '列表展示的组织完整路径；不是提交时必须的替代ID', { optional: true, nullable: true, nullMeaning: '未返回完整路径' }),
  field('postId', 'string | number | null', '招聘岗位ID；必须属于organizationId下的岗位候选', { optional: true, nullable: true, nullMeaning: '未绑定岗位' }),
  field('postName', 'string | null', '提交时保存的岗位名称快照', { optional: true, nullable: true, nullMeaning: '未保存岗位名称' }),
  field('postTypeName', 'string | null', '岗位类型展示值；Portal列表/表单使用，SDK不把它当作Java保存字段', { optional: true, nullable: true, nullMeaning: '岗位没有类型名称' }),
  field('planNumber', 'number | null', '招聘人数；必须为正整数', { optional: true, nullable: true, nullMeaning: '后端未返回人数' }),
  field('purpose', 'string | null', '招聘目的：业务扩编、人才储备或岗位新增', { optional: true, nullable: true, nullMeaning: '未填写目的' }),
  field('requirementText', 'string | null', '任职要求；最多1000字符', { optional: true, nullable: true, nullMeaning: '未填写任职要求' }),
  field('salaryLevelMin', 'string | number | null', '最低薪资等级ID；页面要求与最高等级同时选择', { optional: true, nullable: true, nullMeaning: '未选择最低等级' }),
  field('salaryLevelMax', 'string | number | null', '最高薪资等级ID；页面要求与最低等级同时选择；Portal未校验上下限顺序', { optional: true, nullable: true, nullMeaning: '未选择最高等级' }),
  field('salaryRangeName', 'string | null', '服务端拼出的薪资范围显示名称；不作为提交字段', { optional: true, nullable: true, nullMeaning: '未返回范围名称' }),
  field('urgency', 'string | null', '紧急程度：特急、紧急、常规或储备', { optional: true, nullable: true, nullMeaning: '未填写紧急程度' }),
  field('arrivalDate', 'string | null', '预计到岗日期，格式YYYY-MM-DD', { optional: true, nullable: true, format: 'YYYY-MM-DD', nullMeaning: '未填写到岗日期' }),
  field('remark', 'string | null', '备注；最多1000字符', { optional: true, nullable: true, nullMeaning: '未填写备注' }),
  field('status', 'number | null', '计划状态；1审批中、2已审批、3已驳回、4已取消；状态门禁决定页面动作', { optional: true, nullable: true, nullMeaning: '后端未返回状态' }),
  field('statusName', 'string | null', '状态显示名称', { optional: true, nullable: true, nullMeaning: '后端未返回状态名称' }),
  field('processInstanceId', 'string | null', '流程实例ID；仅用于诊断/流程关联，不把它当业务计划ID', { optional: true, nullable: true, nullMeaning: '尚未创建或后端未返回流程实例' }),
]

const resumeFields: AiField[] = [
  field('id', 'string | number', '招聘简历主键；用于编辑、删除和申请入职', { optional: true }),
  field('planId', 'string | number | null', '所属招聘计划ID', { optional: true, nullable: true, nullMeaning: '后端未返回所属计划' }),
  field('postId', 'string | number | null', '简历对应岗位ID；列表展示值', { optional: true, nullable: true, nullMeaning: '后端未返回岗位' }),
  field('postName', 'string | null', '岗位名称', { optional: true, nullable: true, nullMeaning: '后端未返回岗位名称' }),
  field('name', 'string | null', '候选人姓名；页面必填，最多10字符', { optional: true, nullable: true, nullMeaning: '未填写姓名' }),
  field('age', 'number | null', '年龄；页面要求1到100的整数', { optional: true, nullable: true, nullMeaning: '未填写年龄' }),
  field('sex', '1 | 2 | null', '性别：1男、2女', { optional: true, nullable: true, values: { '1': '男', '2': '女' }, nullMeaning: '未选择性别' }),
  field('education', 'string | null', '学历；页面下拉候选为博士研究生、硕士研究生、本科、大专、高中、初中、小学', { optional: true, nullable: true, nullMeaning: '未选择学历' }),
  field('major', 'string | null', '专业；页面必填，最多20字符', { optional: true, nullable: true, nullMeaning: '未填写专业' }),
  field('workYears', 'string | null', '工作年限；页面必填，最多20字符', { optional: true, nullable: true, nullMeaning: '未填写工作年限' }),
  field('graduateSchool', 'string | null', '毕业院校；页面必填，最多20字符', { optional: true, nullable: true, nullMeaning: '未填写毕业院校' }),
  field('phone', 'string | null', '联系电话；页面必填，最多20字符', { optional: true, nullable: true, nullMeaning: '未填写联系电话' }),
  field('intendedPost', 'string | null', '意向岗位；页面必填，最多20字符', { optional: true, nullable: true, nullMeaning: '未填写意向岗位' }),
  field('expectedSalary', 'string | null', '期望薪资；页面必填，最多20字符', { optional: true, nullable: true, nullMeaning: '未填写期望薪资' }),
  field('attachments', 'string | null', '附件JSON字符串；每项是{name,url}，页面要求1到3件；URL应由base-upload-file产生', { optional: true, nullable: true, nullMeaning: '没有附件或后端未返回', format: 'JSON array' }),
  field('status', 'number | null', '简历状态；列表展示值，创建表单初始为0', { optional: true, nullable: true, nullMeaning: '后端未返回状态' }),
]

const interviewFields: AiField[] = [
  field('id', 'string | number', '面试记录主键；用于编辑和删除', { optional: true }),
  field('resumeId', 'string | number | null', '所属简历ID', { optional: true, nullable: true, nullMeaning: '后端未返回简历关联' }),
  field('planId', 'string | number | null', '所属招聘计划ID；列表响应可能补充', { optional: true, nullable: true, nullMeaning: '后端未返回计划关联' }),
  field('interviewDate', 'string | null', '面试日期，格式YYYY-MM-DD', { optional: true, nullable: true, format: 'YYYY-MM-DD', nullMeaning: '未填写面试日期' }),
  field('interviewer', 'string | null', '面试官；必填，最多50字符', { optional: true, nullable: true, nullMeaning: '未填写面试官' }),
  field('interviewRound', 'string | null', '面试轮次：初面、复面或终面', { optional: true, nullable: true, nullMeaning: '未填写轮次' }),
  ...['professionalKnowledgeScore', 'communicationScore', 'learningAbilityScore', 'executionAbilityScore', 'teamworkScore', 'stabilityScore'].map(name => field(name, 'number | null', `${name}评分；必填整数，范围1到10`, { optional: true, nullable: true, nullMeaning: '未评分' })),
  field('personalAdvantage', 'string | null', '个人优势；最多500字符', { optional: true, nullable: true, nullMeaning: '未填写' }),
  field('personalShortcoming', 'string | null', '个人不足；最多500字符', { optional: true, nullable: true, nullMeaning: '未填写' }),
  field('workExperienceSummary', 'string | null', '工作经历概述；最多500字符', { optional: true, nullable: true, nullMeaning: '未填写' }),
  field('questionAnswer', 'string | null', '问题及回答；必填，最多500字符', { optional: true, nullable: true, nullMeaning: '未填写' }),
  field('conclusion', 'string | null', '面试结论：优先录用、考虑备选、待定复试或不予录用', { optional: true, nullable: true, nullMeaning: '未填写结论' }),
]

const pageOutput = (fields: AiField[], label: string): AiContract['output'] => ({
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', `当前页${label}列表`), field('total', 'number', `符合筛选条件的${label}总数，不是当前页长度`), ...fields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[]且total=0表示当前筛选无记录；权限、网络或响应形状错误会抛出，不能把空结果解释为无权限。',
})
const objectOutput = (fields: AiField[], label: string): AiContract['output'] => ({ shape: 'object', fields, empty: `${label}不是对象或响应形状错误会抛出；可选字段为null时按字段说明解释，不当作0。` })
const arrayOutput = (fields: AiField[], label: string): AiContract['output'] => ({ shape: 'object[]', fields, empty: `[]表示当前会话没有${label}；请求错误不会降级为空数组。` })
const fileOutput: AiContract['output'] = { shape: '{ fileName: string, contentType: string | null, byteLength: number, base64: string }', fields: [field('fileName', 'string', '服务端Content-Disposition文件名；缺失时使用Portal默认名'), field('contentType', 'string | null', '响应Content-Type；缺失时为null', { nullable: true, nullMeaning: '响应没有Content-Type' }), field('byteLength', 'number', '文件字节数'), field('base64', 'string', '文件二进制的标准Base64')], empty: '空文件会抛错。' }
const previewOutput: AiContract['output'] = { shape: '{ fileName: string, contentType: string, byteLength: number }', fields: [field('fileName', 'string', '待导入文件名'), field('contentType', 'string', '按扩展名或调用方提供的MIME'), field('byteLength', 'number', '文件字节数')], empty: '非法扩展名、非法Base64或空文件会抛错。' }
const preparationOutput: AiContract['output'] = { shape: '{ payload: object, tasks: object[] }', fields: [field('payload', 'object', '已按Portal表单规则校验、且只包含Java RecruitmentPlan DTO字段的提交载荷；UI-only postTypeName等字段不发送'), field('tasks', 'object[]', '后端返回的发起人自选审批节点；startUserSelectAssignees的键必须来自tasks[].id'), field('tasks[].id', 'string', 'BPM节点ID'), field('tasks[].minSelectCount', 'number | null', '该节点最少选择人数', { nullable: true, nullMeaning: '没有最少人数限制' }), field('tasks[].maxSelectCount', 'number | null', '该节点最多选择人数', { nullable: true, nullMeaning: '没有最多人数限制' })], empty: 'tasks=[]表示本次流程不需要人工选审批人；仍需以空映射提交。' }
const draftOutput = (label: string, fields: AiField[]): AiContract['output'] => ({ shape: '{ draft: object }', fields: [field('draft', 'object', `${label}尚未提交的完整草稿`), ...fields.map(item => ({ ...item, path: `draft.${item.path}` }))], empty: '校验失败时不生成草稿，也不发写请求；用户取消时直接丢弃草稿。' })
const booleanOutput = (label: string): AiContract['output'] => ({ shape: 'boolean', fields: [field('$', 'boolean', `${label}成功时为true；不是持久化回查证据`)], empty: '服务端未返回true会抛错。' })
const idOutput = (label: string): AiContract['output'] => ({ shape: 'string | number', fields: [field('$', 'string | number', `${label}业务ID；Java Long可能序列化为字符串，原样保留`)], empty: '未返回正整数ID会抛错。' })
const stringOutput = (label: string): AiContract['output'] => ({ shape: 'string', fields: [field('$', 'string', `${label}文本回执；不是写入效果证明`)], empty: '空文本会抛错。' })

const evidence: AiContract['evidence'] = [
  { source: 'Portal recruitment-plan/list.vue、RecruitmentPlanForm.vue、resume/[id].vue、simple/hr/form/026、simple/hr/form/001', kind: 'reference', note: '逐页核对列表请求、表单字段、状态按钮、导入导出、简历和面试页面动作及入职流程跳转。' },
  { source: 'Java RecruitmentPlanController、RecruitmentPlan*ReqVO/RespVO、RecruitmentPlanServiceImpl', kind: 'reference', note: '核对请求路径、DTO白名单、状态门禁、重复覆盖、级联删除和流程节点接口。' },
  { source: 'src/capabilities/recruitment-plan.ts 与 test/recruitment-plan.test.ts', kind: 'implementation', note: '锁定SDK请求投影、本地表单校验、multipart字段、状态规则和反证；不替代真实环境写回查。' },
]
const commonBoundaries = [
  '页面路径是/dashboard/staff/recruitment-plan/list，权限码是/dashboard/staff/recruitment-plan，使用platform实例并发送module-type=11；不要把它解释成独立生产系统能力。',
  '计划、简历和面试是同一招聘计划页面实际可达的业务子动作；SDK不新增通用任意BPM表单，只复刻招聘计划自己的流程字段和接口。',
  '审批人候选复用base-user-search，必须用关键字或部门分页；不复制Portal一次拉取数千人的无头行为。简历附件先用base-upload-file得到OSS URL；Excel导入不复用OSS上传能力。',
]
const commonFailures = ['会话、租户、权限、module-type、数据范围、服务端业务校验、文件响应形状和网络错误原样抛出；空列表只能表示当前筛选无记录，不能解释成无权限。']
const inputFromDefinition = (id: string): Record<string, AiParameter> => Object.fromEntries((definitions.get(id)?.params ?? []).map(spec => [spec.name, param(spec.description ?? spec.name, spec.lookup ? `按${spec.lookup.capabilityId}查询候选；调用方需先确认ID` : '用户明确输入或前一步页面结果', { required: spec.required, type: spec.kind === 'number' ? 'number' : spec.kind === 'boolean' ? 'boolean' : spec.kind === 'date' ? 'string' : 'object | string', ...(spec.options ? { constraints: spec.options.map(option => `${String(option.value)}=${option.label}`) } : {}) })]))
const base = (id: string, value: Omit<AiContract, 'purpose' | 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'inputs' | 'idempotency'> & { purpose: string; inputs?: Record<string, AiParameter>; idempotency?: string | null }): AiContract => ({
  purpose: value.purpose,
  whenToUse: value.purpose,
  effect: value.effect,
  boundaries: commonBoundaries,
  prerequisites: ['使用当前用户会话、当前租户和招聘计划页面权限；组织、岗位、计划、简历和审批人ID必须来自当前租户可见数据或用户明确确认。'],
  inputs: { ...inputFromDefinition(id), ...value.inputs },
  output: value.output,
  consume: value.consume,
  steps: value.steps,
  completion: value.completion,
  failures: commonFailures,
  idempotency: value.idempotency ?? null,
  evidence,
  gaps: ['已完成Portal/Java静态逐页核对与离线反证测试；尚未在真实测试环境执行本页读请求、prepare→create/update→回查、导入、删除或撤销闭环。'],
})
const contracts: Record<string, AiContract> = {}
const add = (id: string, value: Parameters<typeof base>[1]): void => {
  if (!definitions.has(id)) throw new Error(`Recruitment plan contract has no registered definition: ${id}`)
  contracts[id] = base(id, value)
}

add('recruitment-plan-list', { purpose: '按组织、岗位、年度、招聘类型、状态和创建时间查询招聘计划分页。', effect: 'read', output: pageOutput(planFields, '招聘计划'), consume: ['保留list[].id和status作为详情、编辑、简历入口、撤销和删除依据；按total继续分页。'], steps: [{ role: 'optional', when: '需要查看表单或进入简历', capabilityId: 'recruitment-plan-get', mapping: { id: 'result.list[].id' }, instruction: '先读取计划详情；不要只用列表行拼装完整提交表单。' }], completion: '获得当前筛选的一页招聘计划和total。' })
add('recruitment-plan-get', { purpose: '读取招聘计划详情，供编辑、重新提交、简历列表和入职跳转使用。', effect: 'read', output: objectOutput(planFields, '招聘计划详情'), consume: ['status=3才可prepare-update；status=2才可进入简历管理；status=1才可cancel；status!=1才可删除。'], steps: [], completion: '获得可用于下一步动作的完整计划详情。' })
add('recruitment-plan-organization-tree', { purpose: '读取Portal角色组织树，供招聘计划的组织字段选择。', effect: 'read', output: arrayOutput([field('[].id', 'string | number', '组织ID'), field('[].name', 'string | null', '组织名称'), field('[].children', 'object[]', '子组织节点')], '组织候选'), consume: ['用户确认组织后把节点id和名称快照传给prepare；不要把部门ID混作角色组织ID。'], steps: [], completion: '获得当前数据权限内的组织候选。' })
add('recruitment-plan-post-options', { purpose: '按已选组织读取岗位候选。', effect: 'read', output: arrayOutput([field('[].id', 'string | number', '岗位ID'), field('[].name', 'string | null', '岗位名称'), field('[].postTypeName', 'string | null', '岗位类型展示值')], '岗位候选'), consume: ['organizationId变化时清空原postId/postName；只把当前组织候选的id提交。'], steps: [], completion: '获得该组织下的岗位候选。' })
add('recruitment-plan-salary-level-options', { purpose: '读取薪资等级候选，供薪资上下限选择。', effect: 'read', output: arrayOutput([field('[].id', 'string | number', '薪资等级ID'), field('[].name', 'string | null', '薪资等级名称')], '薪资等级候选'), consume: ['提交时salaryLevelMin和salaryLevelMax都必须有值；Portal当前没有比较上下限顺序的规则。'], steps: [], completion: '获得薪资等级候选。' })
add('recruitment-plan-prepare', { purpose: '按Portal招聘计划表单校验字段，并调用服务端读取本次流程需要人工选择的审批人节点。', effect: 'prepare', output: preparationOutput, consume: ['把tasks交给用户按节点选择审批人；选择结果按节点id组成startUserSelectAssignees；用户取消时不调用create。'], steps: [{ role: 'required', when: '用户确认新建且已完成审批人选择', capabilityId: 'recruitment-plan-create', mapping: { draft: 'result.payload', tasks: 'result.tasks' }, instruction: '携带tasks和按节点映射的审批人ID数组提交；重复提示是否覆盖时只能在用户确认后重试overwrite=true。' }, { role: 'cancel', when: '用户取消新建或审批人选择', instruction: '丢弃payload和tasks，不发create。' }], completion: '得到服务端认可的审批节点和可提交载荷，但尚未写入招聘计划。' })
add('recruitment-plan-create', { purpose: '提交招聘计划并启动recruitment_plan审批流程。', effect: 'write', output: idOutput('招聘计划'), consume: ['返回值是业务计划ID，不是流程实例ID；立即list/get回查字段和status。服务端提示重复时先向用户确认，再用同一载荷重试overwrite=true。'], steps: [{ role: 'required', when: '成功或响应超时', capabilityId: 'recruitment-plan-get', mapping: { id: 'result.$' }, instruction: '按返回业务ID读取详情，核对字段、status和processInstanceId；未回查前不要盲目重发。' }, { role: 'cancel', when: '用户在prepare阶段取消', instruction: '不调用create；已提交后不能用此页面能力撤回已落库记录，审批中需调用recruitment-plan-cancel。' }], completion: 'get回查确认同一计划字段和状态后才报告新建完成。', idempotency: '没有requestId；响应超时先按返回ID或重复键回查，只有确认没有落库且用户重新确认后才重试，覆盖只显式使用overwrite=true。' })
add('recruitment-plan-prepare-update', { purpose: '读取被驳回招聘计划的当前完整字段、校验status=3并重新取得审批人节点。', effect: 'prepare', output: { ...preparationOutput, fields: [...preparationOutput.fields, field('draft', 'object', '包含id的重新提交草稿；只允许当前status=3') ] }, consume: ['changes只覆盖用户明确修改的字段；用户取消时丢弃draft和tasks。'], steps: [{ role: 'required', when: '用户确认重新提交', capabilityId: 'recruitment-plan-update', mapping: { draft: 'result.draft', tasks: 'result.tasks' }, instruction: '按节点选择审批人后提交完整草稿。' }, { role: 'cancel', when: '用户取消编辑', instruction: '不调用update。' }], completion: '得到status=3计划的完整重新提交草稿和审批节点。' })
add('recruitment-plan-update', { purpose: '把status=3的招聘计划重新提交为审批流程。', effect: 'write', output: booleanOutput('招聘计划重新提交'), consume: ['成功后按同一业务IDget回查status和字段；不能用true回执替代回查。'], steps: [{ role: 'required', when: '成功或响应超时', capabilityId: 'recruitment-plan-get', mapping: { id: 'args.draft' }, instruction: '从提交草稿中的id回查同一计划，确认重新进入审批状态；超时不要盲目重发。' }], completion: 'get回查确认重新提交状态和字段。', idempotency: '没有requestId；超时先按同一计划ID回查是否已重新提交，未确认前不重发。' })
add('recruitment-plan-cancel', { purpose: '撤销当前用户发起且status=1审批中的招聘计划。', effect: 'write', output: booleanOutput('招聘计划撤销'), consume: ['仅对列表/详情最新status=1的计划调用；成功后list/get回查status=4或Portal实际取消状态。'], steps: [{ role: 'required', when: '成功或响应超时', capabilityId: 'recruitment-plan-get', mapping: { id: 'args.id' }, instruction: '回查同一计划确认状态已变化；未确认不要重发。' }], completion: '回查确认计划不再处于审批中。', idempotency: '没有requestId；超时先按同一计划ID回查状态，仍为审批中且用户确认后才重试。' })
add('recruitment-plan-prepare-delete', { purpose: '按列表最新行状态准备删除招聘计划。', effect: 'prepare', output: draftOutput('招聘计划删除', [field('id', 'string | number', '待删除计划ID')]), consume: ['status=1时只允许cancel，不生成删除草稿；用户取消时丢弃草稿。'], steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'recruitment-plan-remove', mapping: { id: 'result.draft.id' }, instruction: '提交prepare返回的ID；删除会级联删除简历和面试记录。' }, { role: 'cancel', when: '用户取消删除', instruction: '不调用remove。' }], completion: '得到非审批中计划的删除草稿。' })
add('recruitment-plan-remove', { purpose: '删除非审批中的招聘计划。', effect: 'write', output: booleanOutput('招聘计划删除'), consume: ['Java服务会级联删除该计划的简历及面试记录；成功或超时后重新list并核对关联数据已不可见。'], steps: [{ role: 'required', when: '成功或响应超时', capabilityId: 'recruitment-plan-list', instruction: '回查列表确认目标计划消失；不要把HTTP成功当作级联删除证据。' }], completion: '列表和必要的简历/面试回查均确认目标数据不再出现。', idempotency: '没有requestId；超时先按计划ID和关联列表回查，未确认删除前不重试。' })
add('recruitment-plan-download-template', { purpose: '按组织下载Portal招聘计划导入模板。', effect: 'read', output: fileOutput, consume: ['保存base64为Excel文件；organizationId必填，不能下载无组织模板。'], steps: [], completion: '获得非空招聘计划.xlsx模板。' })
add('recruitment-plan-prepare-import', { purpose: '校验Portal招聘计划导入控件接受的.xlsx文件。', effect: 'prepare', output: previewOutput, consume: ['用户取消时不上传；确认后调用importExcel。'], steps: [{ role: 'required', when: '用户确认导入', capabilityId: 'recruitment-plan-import', mapping: { fileName: 'args.fileName', base64: 'args.base64' }, instruction: '首次overwrite=false；服务端提示是否覆盖时展示冲突并等待用户确认。' }, { role: 'cancel', when: '用户取消', instruction: '不发导入请求。' }], completion: '得到可提交的计划导入文件预览。' })
add('recruitment-plan-import', { purpose: '提交招聘计划.xlsx导入。', effect: 'write', output: stringOutput('招聘计划导入'), consume: ['overwrite=false是首次导入；只有服务端明确提示覆盖且用户确认时使用overwrite=true。成功或超时后按组织/年度/岗位回查计划列表。'], steps: [{ role: 'required', when: '导入成功或超时', capabilityId: 'recruitment-plan-list', instruction: '按导入文件的组织、年度和岗位逐条核对，不能用文本回执代替持久化证据。' }], completion: '导入文本回执成功且列表回查确认计划记录。', idempotency: '导入无requestId；超时先按业务条件回查，避免盲目重传。' })
add('recruitment-plan-resume-list', { purpose: '读取指定招聘计划下的简历分页；Portal子页面固定按当前计划和岗位加载。', effect: 'read', output: pageOutput(resumeFields, '招聘简历'), consume: ['保留简历ID；只有status=1的简历显示申请入职动作；附件字符串需按JSON数组解析后再展示。'], steps: [{ role: 'optional', when: '用户查看面试', capabilityId: 'recruitment-plan-interview-list', mapping: { planId: 'args.planId', resumeId: 'result.list[].id' }, instruction: '使用同一计划ID和简历ID读取面试记录。' }], completion: '获得当前计划简历的一页和total。' })
add('recruitment-plan-resume-prepare-create', { purpose: '按Portal简历表单校验候选人字段和1到3件附件，生成Java简历保存载荷。', effect: 'prepare', output: draftOutput('招聘简历', resumeFields), consume: ['计划状态已知时必须为2；附件先用base-upload-file上传，草稿中的attachments序列化为[{name,url}]字符串；取消时不发create。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'recruitment-plan-resume-create', mapping: { draft: 'result.draft' }, instruction: '提交草稿，成功后resume-list回查。' }, { role: 'cancel', when: '用户取消', instruction: '丢弃草稿，不上传或提交。' }], completion: '得到未写入服务端的简历草稿。' })
add('recruitment-plan-resume-create', { purpose: '在已审批招聘计划下新建候选人简历。', effect: 'write', output: idOutput('招聘简历'), consume: ['Java只允许已审批计划；成功或超时后resume-list回查姓名、电话和附件。'], steps: [{ role: 'required', when: '成功或响应超时', capabilityId: 'recruitment-plan-resume-list', mapping: { planId: 'args.draft' }, instruction: '从提交草稿中的planId回查同一计划，并按返回ID核对简历字段。' }], completion: '简历列表回查确认记录和附件元数据。', idempotency: '没有requestId；超时先按planId、姓名和电话回查，未确认没有重复记录前不重试。' })
add('recruitment-plan-resume-prepare-update', { purpose: '按Portal简历编辑规则生成完整更新草稿。', effect: 'prepare', output: draftOutput('招聘简历编辑', resumeFields), consume: ['必须保留详情中的id和planId；已知计划状态时必须为2；附件仍需1到3件。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'recruitment-plan-resume-update', mapping: { draft: 'result.draft' }, instruction: '提交完整草稿后回查同一简历。' }, { role: 'cancel', when: '用户取消编辑', instruction: '不调用update。' }], completion: '得到尚未提交的简历编辑草稿。' })
add('recruitment-plan-resume-update', { purpose: '更新已审批招聘计划下的候选人简历。', effect: 'write', output: booleanOutput('招聘简历更新'), consume: ['成功或超时后resume-list按同一计划和ID回查；true不代表字段已持久化。'], steps: [{ role: 'required', when: '成功或响应超时', capabilityId: 'recruitment-plan-resume-list', mapping: { planId: 'args.draft' }, instruction: '从提交草稿中的planId回查，并按简历ID逐字段核对。' }], completion: '简历列表回查确认更新字段。', idempotency: '没有requestId；超时先按简历ID回查字段是否已更新，未确认前不重发。' })
add('recruitment-plan-resume-prepare-delete', { purpose: '准备删除简历并明确其面试记录会级联删除。', effect: 'prepare', output: draftOutput('招聘简历删除', [field('id', 'string | number', '待删除简历ID')]), consume: ['用户取消时不发DELETE；提交前确认关联面试也会删除。'], steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'recruitment-plan-resume-remove', mapping: { id: 'result.draft.id' }, instruction: '提交ID并在简历/面试列表回查。' }, { role: 'cancel', when: '用户取消', instruction: '不调用removeResume。' }], completion: '得到待删除简历ID。' })
add('recruitment-plan-resume-remove', { purpose: '删除候选人简历及其面试记录。', effect: 'write', output: booleanOutput('招聘简历删除'), consume: ['删除会级联面试记录；成功或超时后resume-list和interview-list回查。'], steps: [{ role: 'required', when: '成功或响应超时', capabilityId: 'recruitment-plan-resume-list', instruction: '确认目标简历不再出现，并用同一resumeId确认面试列表为空。' }], completion: '简历和面试回查确认目标数据已删除。', idempotency: '没有requestId；超时先按简历ID回查简历和面试是否都消失，未确认前不重试。' })
add('recruitment-plan-resume-download-template', { purpose: '下载招聘简历导入模板。', effect: 'read', output: fileOutput, consume: ['保存非空Excel文件；模板接口不需要planId。'], steps: [], completion: '获得非空招聘简历.xlsx模板。' })
add('recruitment-plan-resume-prepare-import', { purpose: '校验招聘简历导入控件接受的.xlsx/.xls文件。', effect: 'prepare', output: previewOutput, consume: ['用户确认后以planId和file调用importResumes；页面没有overwrite二次确认。'], steps: [{ role: 'required', when: '用户确认导入', capabilityId: 'recruitment-plan-resume-import', instruction: '把同一planId和file对象传给importResumes；multipart字段必须是planId和file。' }, { role: 'cancel', when: '用户取消', instruction: '不上传。' }], completion: '得到可提交的简历导入文件预览。' })
add('recruitment-plan-resume-import', { purpose: '向指定已审批招聘计划批量导入简历。', effect: 'write', output: stringOutput('招聘简历导入'), consume: ['成功或超时后resume-list回查导入的候选人；不要把文本回执当作写入证明。'], steps: [{ role: 'required', when: '成功或响应超时', capabilityId: 'recruitment-plan-resume-list', mapping: { planId: 'args.planId' }, instruction: '按姓名、电话和岗位逐条回查。' }], completion: '导入回执成功且简历列表确认数据。', idempotency: '导入没有requestId；超时先回查，不盲目重传。' })
add('recruitment-plan-prepare-onboarding', { purpose: '复刻Portal简历行“申请入职”按钮打开通用入职流程表单所需的路由和query。', effect: 'local', output: objectOutput([field('path', 'string', 'simple/hr/form/001'), field('processKey', 'string', 'ruzhi'), field('bpmMode', 'string', '固定edit'), field('customQuery', 'object', 'Portal传给入职表单的resumeId、planId、employeeName、sex、phone、workExperience、organizationId/name、postId/name')], '入职流程打开参数'), consume: ['仅resume.status=1（适合）时可调用；这是导航参数准备，不是提交入职流程；后续表单001的字段和审批提交必须由对应流程能力或页面调用方负责，不能把此方法报告为入职已提交。'], steps: [], completion: '得到与Portal一致的入职表单打开参数；调用方自行打开流程页面并继续完成入职表单。' })
add('recruitment-plan-interview-list', { purpose: '读取当前简历的面试记录；请求固定pageNo=1、pageSize=100，与Portal弹窗一致。', effect: 'read', output: pageOutput(interviewFields, '面试记录'), consume: ['Portal只消费list并忽略total；SDK保留total供调用方判断是否超过100条。'], steps: [], completion: '获得最多100条当前简历面试记录和服务端total。' })
add('recruitment-plan-interview-prepare-create', { purpose: '按Portal面试表单校验日期、面试官、轮次、六项1到10评分、问题回答和结论。', effect: 'prepare', output: draftOutput('面试记录', interviewFields), consume: ['resumeId以当前简历为准，不能从用户自由输入覆盖；取消时不发create。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'recruitment-plan-interview-create', mapping: { resumeId: 'args.resumeId', draft: 'result.draft' }, instruction: '提交后interview-list回查。' }, { role: 'cancel', when: '用户取消', instruction: '丢弃草稿。' }], completion: '得到未提交的面试记录草稿。' })
add('recruitment-plan-interview-create', { purpose: '为当前候选人新建面试记录。', effect: 'write', output: idOutput('面试记录'), consume: ['成功或超时后interview-list回查面试日期、轮次、评分和结论。'], steps: [{ role: 'required', when: '成功或响应超时', capabilityId: 'recruitment-plan-interview-list', mapping: { resumeId: 'args.resumeId', planId: 'context.planId' }, instruction: '回查同一简历的面试列表。' }], completion: '面试列表回查确认新记录。', idempotency: '没有requestId；超时先按resumeId和面试字段回查，未确认没有重复记录前不重试。' })
add('recruitment-plan-interview-prepare-update', { purpose: '按Portal规则生成面试记录完整更新草稿，并强制绑定当前简历。', effect: 'prepare', output: draftOutput('面试记录编辑', interviewFields), consume: ['必须保留面试记录id；resumeId由当前简历上下文提供。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'recruitment-plan-interview-update', mapping: { resumeId: 'args.resumeId', draft: 'result.draft' }, instruction: '提交后回查面试列表。' }, { role: 'cancel', when: '用户取消', instruction: '不调用updateInterview。' }], completion: '得到未提交的面试编辑草稿。' })
add('recruitment-plan-interview-update', { purpose: '更新当前候选人的面试记录。', effect: 'write', output: booleanOutput('面试记录更新'), consume: ['成功或超时后interview-list回查；服务端回执true不等于字段已回读一致。'], steps: [{ role: 'required', when: '成功或响应超时', capabilityId: 'recruitment-plan-interview-list', mapping: { resumeId: 'args.resumeId', planId: 'context.planId' }, instruction: '逐字段核对目标面试记录。' }], completion: '面试列表回查确认更新字段。', idempotency: '没有requestId；超时先按面试记录ID回查字段是否已更新，未确认前不重发。' })
add('recruitment-plan-interview-prepare-delete', { purpose: '准备删除一条面试记录。', effect: 'prepare', output: draftOutput('面试记录删除', [field('id', 'string | number', '待删除面试记录ID')]), consume: ['用户取消时不发DELETE。'], steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'recruitment-plan-interview-remove', mapping: { id: 'result.draft.id' }, instruction: '删除后重新读取同一简历面试列表。' }, { role: 'cancel', when: '用户取消', instruction: '丢弃草稿。' }], completion: '得到待删除的面试记录ID。' })
add('recruitment-plan-interview-remove', { purpose: '删除一条面试记录。', effect: 'write', output: booleanOutput('面试记录删除'), consume: ['成功或超时后interview-list回查目标ID不再出现。'], steps: [{ role: 'required', when: '成功或响应超时', capabilityId: 'recruitment-plan-interview-list', mapping: { resumeId: 'context.resumeId', planId: 'context.planId' }, instruction: '回查面试列表确认删除效果。' }], completion: '面试列表确认目标记录已消失。', idempotency: '没有requestId；超时先按面试记录ID回查是否已删除，未确认前不重试。' })

export const RECRUITMENT_PLAN_AI_CONTRACTS = contracts
export const RECRUITMENT_PLAN_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(RECRUITMENT_PLAN_METHODS).map(([id, method]) => [`recruitmentPlan.${method}`, { ...RECRUITMENT_PLAN_AI_CONTRACTS[id]!, boundaries: [...RECRUITMENT_PLAN_AI_CONTRACTS[id]!.boundaries, `直接方法使用sdk.recruitmentPlan.${method}；写操作仍须按该方法描述的prepare→写入→回查顺序。`] }]),
)
