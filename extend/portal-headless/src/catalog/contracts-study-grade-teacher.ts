import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  STUDY_GRADE_DELETE_PATH,
  STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH,
  STUDY_GRADE_MANAGEMENT_CENTER_PERMISSION,
  STUDY_GRADE_MODULE_TYPE,
  STUDY_GRADE_PAGE_PATH,
  STUDY_GRADE_PERMISSION,
  STUDY_GRADE_STUDENT_DELETE_PATH,
  STUDY_GRADE_STUDENT_PAGE_PATH,
  STUDY_GRADE_STUDENT_PERMISSION,
  studyGradeCapabilities,
} from '../capabilities/study-grade.js'
import {
  STUDY_TEACHER_MODULE_TYPE,
  STUDY_TEACHER_PAGE_PATH,
  STUDY_TEACHER_SAVE_TEACHER_PATH,
  studyTeacherCapabilities,
} from '../capabilities/study-teacher.js'

const definitions = new Map([
  ...studyGradeCapabilities.map(definition => [definition.id, definition] as const),
  ...studyTeacherCapabilities.map(definition => [definition.id, definition] as const),
])

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

const idRules = [
  '必须是正整数或无前导零的正整数字符串；长ID保留字符串',
  '必须来自当前用户当前页面可见的记录，不能用行号、名称、staffCode或另一张表的ID代替',
]

const idsOutput = (meaning: string): AiContract['output'] => ({
  shape: '{ ids: (string | number)[] }',
  fields: [
    field('$', 'object', meaning),
    field('ids', '(string | number)[]', '经过SDK本地校验、将要提交的ID数组', { constraints: idRules }),
    field('ids[]', 'string | number', '一条待操作记录ID', { constraints: idRules }),
  ],
  empty: 'ids为空、包含非正整数或对象时在本地抛错，不发请求。',
})

const teacherPrepareOutput: AiContract['output'] = {
  shape: '{ draft: { name: string } }',
  fields: [
    field('$', 'object', '外部讲师学员创建的本地草稿'),
    field('draft', 'object', '提交前供用户确认的草稿'),
    field('draft.name', 'string', 'Portal表单中的外部讲师姓名；非空，保留调用方原字符串'),
  ],
  empty: '姓名为空或仅包含空白字符时抛错，不发请求。',
}

const voidOutput: AiContract['output'] = {
  shape: 'void',
  fields: [field('$', 'void', 'Portal/Java成功响应没有供调用方消费的业务数据；SDK只等待请求完成')],
  empty: '请求失败或响应被请求层判定为失败时抛错；成功回执不替代独立回查。',
}

const cancelOutput: AiContract['output'] = {
  shape: '{ cancelled: true }',
  fields: [field('cancelled', 'boolean', '固定为true，表示提交前的本地草稿/ID集合已放弃')],
  empty: '不发HTTP请求；它不能撤销已经提交的DELETE或POST。',
}

const staffCodeOutput: AiContract['output'] = {
  shape: 'number',
  fields: [field('$', 'number', 'Java CommonResult<Long> 解包后的外部讲师学员 staffCode；SDK当前按number返回')],
  empty: '不会把空值当成成功staffCode；请求或响应失败时抛错。',
}

const gradeEvidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:acab69acc7 app/portal/views/dashboard/education/grade/grade/list.vue',
    kind: 'reference',
    note: '逐页核对班级列表的deleteURL=/study/grade/studygrade、deleteIsBatch=true、页面权限归属和列表行status。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:acab69acc7 app/portal/views/dashboard/education/grade/grade/student/[id]/item-list.vue',
    kind: 'reference',
    note: '核对班级详情学员子页的GET/DELETE /study/grade/student、批量删除开关和关联记录列表语义。',
  },
  {
    source: 'CodeReview_Projects_Js@test/portal/main:acab69acc7 app/portal/views/dashboard/education/base/management-center/grade/[managementCenterId]/item-list.vue',
    kind: 'reference',
    note: '核对组织结构隐藏班级页复用DELETE /study/grade/studygrade；其页面权限不能误写成班级主页面权限。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:0f1a55718eb StudyGradeController.java、StudyGradeStudentRelController.java',
    kind: 'reference',
    note: '核对DELETE方法的@RequestBody Long[] ids、CommonResult成功回执、启用班级删除及班主任关联的服务端业务门禁。',
  },
  {
    source: 'src/capabilities/study-grade.ts、test/study-grade.test.ts、docs/pages/班级管理.md',
    kind: 'implementation',
    note: '锁定SDK的ID校验、裸数组body、platform实例、module-type=12、三个页面上下文和本地cancel行为。',
  },
]

const teacherEvidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:acab69acc7 app/portal/views/dashboard/education/base/teacher/[mode]/[id].vue',
    kind: 'reference',
    note: '逐页核对仅在新建且没有staffCode时调用POST /study/base/studystudent/saveTeacher，body为{name: form.name}。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:0f1a55718eb StudyStudentController.java',
    kind: 'reference',
    note: '核对@PostMapping("/saveTeacher")、saveStudent(String name)和CommonResult<Long>返回类型。',
  },
  {
    source: 'src/capabilities/study-teacher.ts、test/study-teacher.test.ts、docs/pages/讲师管理.md',
    kind: 'implementation',
    note: '锁定姓名非空校验、platform实例、module-type=12、POST DTO body、staffCode解包和本地cancel行为。',
  },
]

const gradeGaps = [
  '尚未在真实测试环境完成该页面的浏览器读请求和DELETE prepare→submit→cancel闭环；当前结论来自固定Portal/Java源码、SDK实现和离线测试。',
  'Java服务端才是启用班级删除、班主任关联移出等业务规则的最终裁决者；SDK的prepare只校验ID，不会把当前status原子地锁在删除请求中，调用方必须用当前列表行核对后再确认。',
  '班级详情学员子页和组织结构隐藏班级子页的独立回查端点尚未注册为对应SDK读能力；契约保留Portal GET回查要求，但无法把未注册的回查说成SDK已完成。',
]

const teacherGaps = [
  '尚未在真实测试环境完成该页面的浏览器读请求和POST prepare→submit→cancel闭环；当前结论来自固定Portal/Java源码、SDK实现和离线测试。',
  'Java saveStudent(String name)没有@RequestBody注解，而Portal实际发送JSON对象{name}；当前SDK忠实复刻Portal wire body，但Spring绑定在部署配置中的稳定性仍需真实环境验证。',
  'saveTeacher只创建外部讲师对应的学员记录，不等于后续/manage/addProfessorStudy.lay讲师主体保存；独立回查只能确认学员记录/staffCode，不可据此宣称讲师主体已创建。',
]

const gradeDeleteIdInput = (source: string, meaning: string): Record<string, AiParameter> => ({
  ids: input(meaning, source, { type: '(string | number)[]', constraints: ['非空数组', ...idRules] }),
})

const teacherNameInput: Record<string, AiParameter> = {
  name: input('外部讲师姓名；仅用于Portal新建表单中staffCode缺失的分支。', 'Portal讲师新建表单的form.name；调用前确认form.staffCode为空或缺省。', {
    type: 'string',
    format: '非空字符串',
    constraints: ['trim后不能为空', '保留原字符串发送，不把姓名改成已有讲师ID'],
  }),
}

const teacherDraftInput: Record<string, AiParameter> = {
  draft: input('prepareSaveTeacher返回的完整草稿；提交时只能传同一份草稿。', 'study-teacher-prepare-save-teacher.result.draft', {
    type: '{ name: string }',
    constraints: ['必须包含非空name', '不要改成裸字符串或补充Portal没有提交的字段'],
  }),
  'draft.name': input('外部讲师姓名；来自 prepare 返回的 draft.name，按 Portal 原字段发送。', 'study-teacher-prepare-save-teacher.result.draft.name', {
    type: 'string',
    format: '非空字符串',
  }),
}

type Context = {
  pagePath: string
  permission: string
  moduleType: number
  boundaries: string[]
  prerequisites: string[]
  evidence: AiContract['evidence']
  gaps: string[]
}

const gradeContext: Context = {
  pagePath: STUDY_GRADE_PAGE_PATH,
  permission: STUDY_GRADE_PERMISSION,
  moduleType: STUDY_GRADE_MODULE_TYPE,
  boundaries: [
    `仅覆盖Portal班级管理页 ${STUDY_GRADE_PAGE_PATH} 的班级批量删除；页面权限是 ${STUDY_GRADE_PERMISSION}，请求使用platform实例并发送module-type=${STUDY_GRADE_MODULE_TYPE}。`,
    `Portal/Java端点是DELETE ${STUDY_GRADE_DELETE_PATH}，body为裸Long[] ID数组，无query；不要包装成{ ids }。`,
    '删除对象必须来自当前班级列表的list[].id；当前行status必须先核对为0（停用）再请求，启用班级由Java服务拒绝，SDK不会伪造本地成功。',
  ],
  prerequisites: [
    '使用当前用户、当前租户的会话token创建SDK；页面权限和服务端数据范围仍由Portal/Java裁决。',
    '从最近一次study-grade-list结果保留同一条list[].id和list[].status；不要用名称、行号或其他页面ID代替。',
  ],
  evidence: gradeEvidence,
  gaps: gradeGaps,
}

const gradeStudentContext: Context = {
  pagePath: STUDY_GRADE_STUDENT_PAGE_PATH,
  permission: STUDY_GRADE_STUDENT_PERMISSION,
  moduleType: STUDY_GRADE_MODULE_TYPE,
  boundaries: [
    `仅覆盖Portal班级详情学员子页 ${STUDY_GRADE_STUDENT_PAGE_PATH} 的批量移出学员；权限是 ${STUDY_GRADE_STUDENT_PERMISSION}，请求使用platform实例并发送module-type=${STUDY_GRADE_MODULE_TYPE}。`,
    `Portal/Java端点是DELETE ${STUDY_GRADE_STUDENT_DELETE_PATH}，body为班级学员关联记录ID的裸Long[]数组，无query；不要传学员主表ID、staffCode或{ ids }。`,
    '本动作没有可供SDK提交的status字段；ID必须取自当前班级详情关联列表的list[].id，Java会拒绝移出班主任等不允许的关系。',
  ],
  prerequisites: [
    '使用当前用户、当前租户的会话token创建SDK，并确认当前班级详情页权限。',
    '从当前班级详情的关联列表保留关系记录list[].id和所属gradeId；不要把study-student-list的学员主表list[].id直接当成删除ID。',
  ],
  evidence: gradeEvidence,
  gaps: gradeGaps,
}

const managementCenterContext: Context = {
  pagePath: STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH,
  permission: STUDY_GRADE_MANAGEMENT_CENTER_PERMISSION,
  moduleType: STUDY_GRADE_MODULE_TYPE,
  boundaries: [
    `仅覆盖Portal组织结构隐藏班级子页 ${STUDY_GRADE_MANAGEMENT_CENTER_PAGE_PATH} 的批量删除；权限是 ${STUDY_GRADE_MANAGEMENT_CENTER_PERMISSION}，请求使用platform实例并发送module-type=${STUDY_GRADE_MODULE_TYPE}。`,
    `该页复用Portal/Java端点DELETE ${STUDY_GRADE_DELETE_PATH}，body为裸Long[]班级ID数组，无query；不要包装成{ ids }。`,
    'ID必须取自当前组织结构下班级列表的list[].id；先核对当前行status为0（停用），Java服务仍会执行最终业务校验，不能用组织ID代替班级ID。',
  ],
  prerequisites: [
    '使用当前用户、当前租户的会话token创建SDK，并确认组织结构页面权限。',
    '从最近一次该组织结构班级子页结果保留同一条班级list[].id和list[].status；不要跨组织结构复用旧ID。',
  ],
  evidence: gradeEvidence,
  gaps: gradeGaps,
}

const teacherContext: Context = {
  pagePath: STUDY_TEACHER_PAGE_PATH,
  permission: '/dashboard/base/teacher',
  moduleType: STUDY_TEACHER_MODULE_TYPE,
  boundaries: [
    `仅覆盖Portal讲师新建页 ${STUDY_TEACHER_PAGE_PATH} 在staffCode缺失时创建外部讲师学员记录；权限是 /dashboard/base/teacher，使用platform实例并发送module-type=${STUDY_TEACHER_MODULE_TYPE}。`,
    `Portal/Java端点是POST ${STUDY_TEACHER_SAVE_TEACHER_PATH}，body为JSON DTO { name }，无query；不要传裸姓名字符串、讲师主体字段或已有讲师ID。`,
    '这是saveTeacher辅助动作，不覆盖讲师主体的/manage/addProfessorStudy.lay保存、编辑或删除；已有staffCode时Portal不会走该端点。',
  ],
  prerequisites: [
    '使用当前用户、当前租户的会话token创建SDK，并拥有讲师管理页权限。',
    '仅在Portal新建表单的staffCode缺失分支调用；name必须来自当前用户明确填写的表单值。',
  ],
  evidence: teacherEvidence,
  gaps: teacherGaps,
}

const writeIdempotency = '端点没有requestId，SDK不伪造服务端幂等键；请求完成或超时后必须先独立回查，确认未落库前不得盲目重试。'

function base (
  id: string,
  purpose: string,
  effect: AiContract['effect'],
  inputs: Record<string, AiParameter>,
  output: AiContract['output'],
  consume: string[],
  steps: AiContract['steps'],
  completion: string,
  context: Context,
  extra: Partial<AiContract> = {},
): AiContract {
  if (!definitions.has(id)) throw new Error(`study-grade/teacher契约缺少能力定义：${id}`)
  return {
    purpose,
    whenToUse: purpose,
    boundaries: context.boundaries,
    effect,
    prerequisites: context.prerequisites,
    inputs,
    output,
    consume,
    steps,
    completion,
    failures: [
      '非法ID、空数组、空姓名或不匹配的prepare结果必须在发请求前失败；不要把本地cancel当成服务端撤销。',
      '401/403、网络错误和Java业务校验错误原样抛出；HTTP成功或请求未抛错都不替代独立回查。',
    ],
    idempotency: null,
    evidence: context.evidence,
    gaps: context.gaps,
    ...extra,
  }
}

const contracts: Record<string, AiContract> = {
  'study-grade-prepare-remove': base(
    'study-grade-prepare-remove',
    '按当前班级列表行准备删除班级的ID集合，不发送DELETE。',
    'prepare',
    gradeDeleteIdInput('study-grade-list.result.list[].id', '待删除班级ID数组；必须来自当前班级列表。'),
    idsOutput('删除班级的本地准备结果；prepare只校验ID，不读取或锁定服务端状态。'),
    ['向用户展示选中的班级ID及当前列表status；只对status=0（停用）的行请求删除确认。', '用户取消时调用本地cancel能力，不发送DELETE。'],
    [
      { role: 'required', when: '用户确认删除且当前行status已核对为0', capabilityId: 'study-grade-remove', mapping: { ids: 'result.ids' }, instruction: '将同一份prepare结果的ids原样交给remove；不要改成{ ids }请求体。' },
      { role: 'cancel', when: '用户取消删除', capabilityId: 'study-grade-cancel-remove', mapping: {}, instruction: '放弃本地ids，不发送任何HTTP请求。' },
    ],
    '得到经过本地ID校验、尚未产生服务端副作用的删除ID集合。',
    gradeContext,
  ),
  'study-grade-remove': base(
    'study-grade-remove',
    `按Portal班级管理页规则删除班级：发送DELETE ${STUDY_GRADE_DELETE_PATH}，body为裸班级ID数组。`,
    'write',
    gradeDeleteIdInput('study-grade-prepare-remove.result.ids', 'prepare返回的待删除班级ID数组。'),
    voidOutput,
    ['成功或超时后以study-grade-list重新查询，并按同一ID核对目标行已不再作为可见班级返回；若仍存在，读取其状态/删除标记并报告，不能只凭HTTP成功宣布完成。'],
    [
      { role: 'required', when: '用户确认且已有prepare结果', capabilityId: 'study-grade-remove', mapping: { ids: 'args.ids' }, instruction: '调用DELETE并让SDK把ids编码为裸数组body。' },
      { role: 'recovery', when: '请求成功、超时或响应不确定', capabilityId: 'study-grade-list', mapping: {}, instruction: '独立回查班级列表；按ID核对删除效果，未确认前不要重试。' },
      { role: 'cancel', when: '用户尚未确认而放弃prepare结果', capabilityId: 'study-grade-cancel-remove', mapping: {}, instruction: '提交前取消只丢弃本地ids；DELETE一旦发出没有本页撤销接口。' },
    ],
    'DELETE请求完成且独立班级列表回查确认目标ID不再可见；否则只能报告请求结果和回查缺口。',
    gradeContext,
    { idempotency: writeIdempotency },
  ),
  'study-grade-cancel-remove': base(
    'study-grade-cancel-remove',
    '取消尚未提交的班级删除ID集合。',
    'local',
    {},
    cancelOutput,
    ['丢弃prepare返回的ids；它不回滚已经发送的DELETE。'],
    [],
    '返回cancelled=true且没有网络副作用。',
    gradeContext,
  ),

  'study-grade-student-prepare-remove': base(
    'study-grade-student-prepare-remove',
    '按当前班级详情学员关联列表准备移出学员的关联记录ID集合，不发送DELETE。',
    'prepare',
    gradeDeleteIdInput('Portal班级详情GET /study/grade/student.result[].id', '待移出的班级学员关联记录ID数组；不是学员主表ID。'),
    idsOutput('移出班级学员的本地准备结果；prepare只校验关联记录ID。'),
    ['向用户展示班级、学员和关联记录ID后确认；不要把study-student-list的学员主表ID或staffCode替换进ids。', '用户取消时调用本地cancel能力，不发送DELETE。'],
    [
      { role: 'required', when: '用户确认移出且ID来自当前班级详情列表', capabilityId: 'study-grade-student-remove', mapping: { ids: 'result.ids' }, instruction: '将同一份ids原样交给removeStudents；请求体必须是裸关联记录ID数组。' },
      { role: 'cancel', when: '用户取消移出', capabilityId: 'study-grade-student-cancel-remove', mapping: {}, instruction: '放弃本地ids，不发送HTTP请求。' },
    ],
    '得到经过本地ID校验、尚未产生服务端副作用的关联记录ID集合。',
    gradeStudentContext,
  ),
  'study-grade-student-remove': base(
    'study-grade-student-remove',
    '按Portal班级详情学员子页规则移出学员：发送DELETE /study/grade/student，body为裸关联记录ID数组。',
    'write',
    gradeDeleteIdInput('study-grade-student-prepare-remove.result.ids', 'prepare返回的班级学员关联记录ID数组。'),
    voidOutput,
    ['成功或超时后必须重新加载同一班级的GET /study/grade/student并确认目标关联记录消失；当前SDK没有注册该子页的独立回查能力，无法把未执行的GET报告为已验证。'],
    [
      { role: 'required', when: '用户确认且已有prepare结果', capabilityId: 'study-grade-student-remove', mapping: { ids: 'args.ids' }, instruction: '调用DELETE并让SDK把ids编码为裸数组body。' },
      { role: 'recovery', when: '请求成功、超时或响应不确定', mapping: {}, instruction: '通过Portal班级详情的GET /study/grade/student按原gradeId独立回查；SDK当前未注册该读能力，不能用study-student-list替代。' },
      { role: 'cancel', when: '用户尚未确认而放弃prepare结果', capabilityId: 'study-grade-student-cancel-remove', mapping: {}, instruction: '提交前取消只丢弃本地ids；DELETE一旦发出没有本页撤销接口。' },
    ],
    'DELETE请求完成且班级详情学员列表独立回查确认目标关联ID消失；没有该回查证据时只报告请求结果。',
    gradeStudentContext,
    { idempotency: writeIdempotency },
  ),
  'study-grade-student-cancel-remove': base(
    'study-grade-student-cancel-remove',
    '取消尚未提交的班级学员移出ID集合。',
    'local',
    {},
    cancelOutput,
    ['丢弃prepare返回的关联记录ids；不能撤销已经发送的DELETE。'],
    [],
    '返回cancelled=true且没有网络副作用。',
    gradeStudentContext,
  ),

  'study-grade-management-center-prepare-remove': base(
    'study-grade-management-center-prepare-remove',
    '按组织结构隐藏班级子页当前列表准备删除班级的ID集合，不发送DELETE。',
    'prepare',
    gradeDeleteIdInput('Portal组织结构班级子页GET /study/grade/studygrade/page.result.list[].id', '待删除班级ID数组；必须来自当前组织结构下班级列表。'),
    idsOutput('组织结构隐藏班级页删除的本地准备结果；prepare只校验ID，不锁定服务端状态。'),
    ['向用户展示组织结构、班级名称、ID及当前列表status；只对status=0（停用）的班级请求删除确认。', '用户取消时调用本地cancel能力，不发送DELETE。'],
    [
      { role: 'required', when: '用户确认删除且当前行status已核对为0', capabilityId: 'study-grade-management-center-remove', mapping: { ids: 'result.ids' }, instruction: '将同一份ids原样交给removeManagementCenterGrades；不要传组织结构ID。' },
      { role: 'cancel', when: '用户取消组织结构下班级删除', capabilityId: 'study-grade-management-center-cancel-remove', mapping: {}, instruction: '放弃本地ids，不发送HTTP请求。' },
    ],
    '得到经过本地ID校验、尚未产生服务端副作用的组织结构班级删除ID集合。',
    managementCenterContext,
  ),
  'study-grade-management-center-remove': base(
    'study-grade-management-center-remove',
    '按组织结构隐藏班级子页规则删除班级：复用DELETE /study/grade/studygrade，body为裸班级ID数组。',
    'write',
    gradeDeleteIdInput('study-grade-management-center-prepare-remove.result.ids', 'prepare返回的组织结构下班级ID数组。'),
    voidOutput,
    ['成功或超时后重新加载同一组织结构班级子页，按同一ID核对目标班级不再可见；该隐藏页的回查仍是Portal GET，当前SDK没有带managementCenterId的独立能力。'],
    [
      { role: 'required', when: '用户确认且已有prepare结果', capabilityId: 'study-grade-management-center-remove', mapping: { ids: 'args.ids' }, instruction: '调用DELETE并让SDK把ids编码为裸数组body。' },
      { role: 'recovery', when: '请求成功、超时或响应不确定', mapping: {}, instruction: '通过组织结构班级子页GET /study/grade/studygrade/page按原managementCenterId和筛选条件独立回查；不能只回查组织主表。' },
      { role: 'cancel', when: '用户尚未确认而放弃prepare结果', capabilityId: 'study-grade-management-center-cancel-remove', mapping: {}, instruction: '提交前取消只丢弃本地ids；DELETE一旦发出没有本页撤销接口。' },
    ],
    'DELETE请求完成且组织结构班级子页独立回查确认目标ID不再可见；没有该回查证据时只报告请求结果。',
    managementCenterContext,
    { idempotency: writeIdempotency },
  ),
  'study-grade-management-center-cancel-remove': base(
    'study-grade-management-center-cancel-remove',
    '取消尚未提交的组织结构班级删除ID集合。',
    'local',
    {},
    cancelOutput,
    ['丢弃prepare返回的ids；不能撤销已经发送的DELETE。'],
    [],
    '返回cancelled=true且没有网络副作用。',
    managementCenterContext,
  ),

  'study-teacher-prepare-save-teacher': base(
    'study-teacher-prepare-save-teacher',
    '按Portal讲师新建表单规则准备创建外部讲师学员记录的姓名草稿，不发送POST。',
    'prepare',
    teacherNameInput,
    teacherPrepareOutput,
    ['向用户展示draft.name并确认；仅用于新建表单staffCode缺失的分支，不能把它当作讲师主体草稿。', '用户取消时调用本地cancel能力，不发送POST。'],
    [
      { role: 'required', when: '用户确认创建外部讲师学员记录', capabilityId: 'study-teacher-save-teacher', mapping: { draft: 'result.draft' }, instruction: '将同一份draft交给saveTeacher；请求体由SDK编码为{name}。' },
      { role: 'cancel', when: '用户取消创建', capabilityId: 'study-teacher-cancel-save-teacher', mapping: {}, instruction: '放弃本地draft，不发送HTTP请求。' },
    ],
    '得到姓名非空、尚未产生服务端副作用的外部讲师学员创建草稿。',
    teacherContext,
  ),
  'study-teacher-save-teacher': base(
    'study-teacher-save-teacher',
    '按Portal讲师新建页规则创建外部讲师对应的学员记录：发送POST /study/base/studystudent/saveTeacher，body为{name}。',
    'write',
    teacherDraftInput,
    staffCodeOutput,
    ['保存返回的staffCode；成功或超时后用study-student-list按name回查并核对staffCode/记录，姓名不唯一时不能把模糊命中当成独立证据。', '该回查只证明外部讲师学员记录，不证明/manage/addProfessorStudy.lay已保存讲师主体。'],
    [
      { role: 'required', when: '用户确认且已有prepare结果', capabilityId: 'study-teacher-save-teacher', mapping: { draft: 'args.draft' }, instruction: '发送platform POST，body严格为{ name: args.draft.name }，无query。' },
      { role: 'recovery', when: '请求成功、超时或响应不确定', capabilityId: 'study-student-list', mapping: { name: 'args.draft.name' }, instruction: '用姓名查询学员候选并核对返回的staffCode与本次结果；同名或缺少staffCode时报告无法独立确认，不要盲目重试。' },
      { role: 'cancel', when: '用户尚未确认而放弃prepare结果', capabilityId: 'study-teacher-cancel-save-teacher', mapping: {}, instruction: '提交前取消只丢弃本地draft；POST一旦发出没有saveTeacher撤销接口。' },
    ],
    'POST请求完成、返回staffCode且独立学员列表回查确认同一记录；没有回查证据时只报告请求结果。',
    teacherContext,
    { idempotency: writeIdempotency },
  ),
  'study-teacher-cancel-save-teacher': base(
    'study-teacher-cancel-save-teacher',
    '取消尚未提交的外部讲师学员创建姓名草稿。',
    'local',
    {},
    cancelOutput,
    ['丢弃prepare返回的draft；不能撤销已经发送的POST，也不会删除学员记录。'],
    [],
    '返回cancelled=true且没有网络副作用。',
    teacherContext,
  ),
}

const METHOD_PATHS = {
  'study-grade-prepare-remove': 'studyGrade.prepareRemove',
  'study-grade-remove': 'studyGrade.remove',
  'study-grade-cancel-remove': 'studyGrade.cancelRemove',
  'study-grade-student-prepare-remove': 'studyGrade.prepareRemoveStudents',
  'study-grade-student-remove': 'studyGrade.removeStudents',
  'study-grade-student-cancel-remove': 'studyGrade.cancelRemoveStudents',
  'study-grade-management-center-prepare-remove': 'studyGrade.prepareRemoveManagementCenterGrades',
  'study-grade-management-center-remove': 'studyGrade.removeManagementCenterGrades',
  'study-grade-management-center-cancel-remove': 'studyGrade.cancelRemoveManagementCenterGrades',
  'study-teacher-prepare-save-teacher': 'studyTeacher.prepareSaveTeacher',
  'study-teacher-save-teacher': 'studyTeacher.submitSaveTeacher',
  'study-teacher-cancel-save-teacher': 'studyTeacher.cancelSaveTeacher',
} as const

export const STUDY_GRADE_TEACHER_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.keys(METHOD_PATHS).map(id => [id, contracts[id]!]),
)

export const STUDY_GRADE_TEACHER_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(METHOD_PATHS).map(([id, methodPath]) => [methodPath, STUDY_GRADE_TEACHER_AI_CONTRACTS[id]!]),
)
