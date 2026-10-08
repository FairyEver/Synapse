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
  STUDY_APPRAISE_SETTING_PAGE_PATH,
  STUDY_APPRAISE_SETTING_SAVE_PATH,
  STUDY_TEACHER_CANDIDATE_STUDENT_PATH,
  STUDY_TEACHER_DELETE_PATH,
  STUDY_TEACHER_LEVEL_CREATE_PATH,
  STUDY_TEACHER_LEVEL_DELETE_PATH,
  STUDY_TEACHER_LEVEL_PAGE_PATH,
  STUDY_TEACHER_LEVEL_STATUS_PATH,
  STUDY_TEACHER_LEVEL_UPDATE_PATH,
  STUDY_TEACHER_MODULE_TYPE,
  STUDY_TEACHER_PAGE_PATH,
  STUDY_TEACHER_SAVE_TEACHER_PATH,
  STUDY_TEACHER_STATUS_PATH,
  STUDY_TEACHER_TYPE_DICT_PATH,
  STUDY_TEACHER_TYPE_DICT_TYPE,
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

const teacherFormInput: Record<string, AiParameter> = {
  form: input('Portal 讲师表单对象；保存时按 create/edit 分支提交。', 'Portal 讲师表单页 [mode]/[id].vue 的 formState', {
    type: 'object',
    constraints: [
      '必须保留 name、jobTitle、briefIntro、detailedIntro、img、level、teacherType 这些页面必填字段。',
      'edit 必须带当前讲师 id；create 不带 id。staffCode 有值时沿用已有学员，缺失时 Portal 会先创建外部讲师学员。',
      'videoIds 只能是数组或 null；页面保存时单独放在 body.videoIds。',
    ],
  }),
  'form.id': input('讲师主体 ID；编辑必填。', 'study-teacher-list.result.list[].id', { type: 'string | number', required: false, requiredWhen: 'mode=edit 时必填' }),
  'form.staffCode': input('讲师对应学员工号；新建外部讲师时可留空触发 saveTeacher。', '讲师表单的 staffCode', { type: 'string | number', required: false, nullable: true, nullMeaning: '新建外部讲师，Portal 会先创建学员记录' }),
}

const teacherStatusInput: Record<string, AiParameter> = {
  id: input('讲师主体 ID。', 'study-teacher-list.result.list[].id', { type: 'string | number' }),
  currentStatus: input('当前状态，只能是 0 或 1。', 'study-teacher-list.result.list[].status', { type: '0 | 1' }),
}

const teacherStatusDraftInput: Record<string, AiParameter> = {
  draft: input('prepareStatus 返回的状态草稿。', 'study-teacher-prepare-status.result.draft', { type: '{ id: string | number, status: 0 | 1 }' }),
}

const levelStatusInput: Record<string, AiParameter> = {
  id: input('讲师类型 ID。', 'study-teacher-level-list.result.list[].id', { type: 'string | number' }),
  currentStatus: input('当前状态，只能是 0 或 1。', 'study-teacher-level-list.result.list[].status', { type: '0 | 1' }),
}

const levelStatusDraftInput: Record<string, AiParameter> = {
  draft: input('prepareLevelStatus 返回的状态草稿。', 'study-teacher-level-prepare-status.result.draft', { type: '{ id: string | number, status: 0 | 1 }' }),
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

const teacherManagementContext: Context = {
  pagePath: STUDY_TEACHER_PAGE_PATH,
  permission: '/dashboard/base/teacher',
  moduleType: STUDY_TEACHER_MODULE_TYPE,
  boundaries: [
    `覆盖 Portal 讲师管理页 ${STUDY_TEACHER_PAGE_PATH} 的讲师主体保存、启停和删除；权限是 /dashboard/base/teacher，按各能力定义使用 smart-layer-admin 或 platform 实例并发送 module-type=${STUDY_TEACHER_MODULE_TYPE}。`,
    '讲师主体保存会先按 Portal 分支创建缺失的外部讲师学员记录，再调用讲师主体接口；任一步失败都可能留下部分副作用，不能把一次请求当作原子事务。',
    '启停与删除的 ID 必须来自当前讲师列表；状态接口是 GET 写操作，删除接口是 platform DELETE 裸 ID 数组，不要按 HTTP 动词猜测其读写属性。',
  ],
  prerequisites: [
    '使用当前用户、当前租户的会话 token 创建 SDK，并确认讲师管理页权限。',
    '保存编辑草稿必须来自当前表单；启停/删除 ID 必须来自最近一次讲师列表，写后按同一 ID 回查。',
  ],
  evidence: teacherEvidence,
  gaps: teacherGaps,
}


const writeIdempotency = '端点没有requestId，SDK不伪造服务端幂等键；请求完成或超时后必须先独立回查，确认未落库前不得盲目重试。'

/**
 * 讲师管理页上「走 platform 实例」的那一类请求（人员候选）。
 *
 * 与 `teacherContext` 的区别只在实例：讲师页的列表走 smart-layer-admin，
 * 而 `studentNoTeacherList` 在页面上写的是 `import { http } from platform.js`。
 * 同一次页面操作里两个实例，所以这里分开记。
 */
const teacherCandidateContext: Context = {
  pagePath: STUDY_TEACHER_PAGE_PATH,
  permission: '/dashboard/base/teacher',
  moduleType: STUDY_TEACHER_MODULE_TYPE,
  boundaries: [
    `仅覆盖 Portal 讲师管理页 ${STUDY_TEACHER_PAGE_PATH} 表单里「讲师姓名」下拉的候选读取；权限是 /dashboard/base/teacher，走 platform 实例、发送 module-type=${STUDY_TEACHER_MODULE_TYPE}。`,
    `端点是 GET ${STUDY_TEACHER_CANDIDATE_STUDENT_PATH}，**没有任何参数**（页面就是 http.get(url)）；SDK 不提供关键字或分页入口。`,
    '候选取的是「还不是讲师的学员」，与 base-user-search（/system/user/simple-page，返回 sys_user.id）不是同一份名单，两者不能互换。',
  ],
  prerequisites: [
    '使用当前用户、当前租户的会话 token 创建 SDK，并拥有讲师管理页权限。',
    '只有在需要为讲师表单挑人（新建外部讲师或把已有学员设为讲师）时读取；候选里的 staffCode 必须由用户确认后再用于写操作。',
  ],
  evidence: [
    {
      source: 'CodeReview_Projects_Js@test/portal/main:82651c98c5 app/portal/views/dashboard/education/base/teacher/[mode]/[id].vue（约 185 行）',
      kind: 'reference',
      note: '确认该请求走 platform 实例、无参数、返回值被映射为 {value: staffCode, label: name}；固定检出源码证据，未在真实环境调用。',
    },
    {
      source: 'CodeReview_Mall_Platform_Java@test/test:998ce8223fa StudyStudentController#studentNoTeacherList',
      kind: 'reference',
      note: '确认后端方法无参数并返回 List<StudyStudentDTO>；未核实返回规模。',
    },
  ],
  gaps: [
    '候选人数的规模**未实测**：后端没有关键字/分页入口，返回的是全部「还不是讲师的学员」，SDK 无法在本地收敛它。',
    '尚未在真实测试环境调用过这个端点。',
  ],
}

/** 讲师类型表单页（隐藏路由 `[mode]/[id].vue`），列表与写入口都走 smart-layer-admin */
const levelContext: Context = {
  pagePath: STUDY_TEACHER_LEVEL_PAGE_PATH,
  permission: '/dashboard/base/teacher-level',
  moduleType: STUDY_TEACHER_MODULE_TYPE,
  boundaries: [
    `覆盖 Portal 讲师类型页 ${STUDY_TEACHER_LEVEL_PAGE_PATH} 表单页的保存动作（隐藏路由 [mode]/[id].vue）；权限是 /dashboard/base/teacher-level，走 smart-layer-admin 实例并发送 module-type=${STUDY_TEACHER_MODULE_TYPE}。`,
    `create 打 ${STUDY_TEACHER_LEVEL_CREATE_PATH}，edit 打 ${STUDY_TEACHER_LEVEL_UPDATE_PATH}；两条都是 POST + JSON body，页面按 isCreateMode 二选一。`,
    '保存成功后**没有**业务返回值可读；SDK 通过 smart-layer 的 code 判定成败，并要求用 study-teacher-level-list 回查确认。',
    'SDK 复刻页面的 omit(form, [createTime, updateTime])：会保留 bridge 行上的业务字段（编辑态可能包含 status 等），同时重新校验 name/level/sort；不会把审计时间字段发回。',
  ],
  prerequisites: [
    '使用当前用户、当前租户的会话 token 创建 SDK，并拥有讲师类型页权限。',
    'smart-layer-admin 实例的 baseURL 必须由调用方在 httpBaseUrls 里显式给出，否则 SDK 失败关闭、不发请求（conventions 第 27 条）。',
    '修改一条类型时先取得该行的 id（来自 study-teacher-level-list），不要用类型名称代替。',
  ],
  evidence: [
    {
      source: 'CodeReview_Projects_Js@test/portal/main:82651c98c5 app/portal/views/dashboard/education/base/teacher-level/[mode]/[id].vue 与 list.vue',
      kind: 'reference',
      note: '确认两个 .lay 端点、POST 形状、表单初值与 rules（name ≤10 字 / level 1~99 / sort 1~999）、编辑态 level 输入框 disabled；固定检出源码证据，未在真实环境调用。',
    },
    {
      source: 'src/capabilities/study-teacher.ts',
      kind: 'implementation',
      note: '锁定端点选择、body 键序、本地校验与 code 判定；未覆盖 smart-layer 后端的字段要求。',
    },
  ],
  gaps: [
    'smart-layer 后端（`.lay` 那一侧）**不在本仓库的两个固定检出内**：额外业务字段是否必需无法在源码侧确认；SDK 会保留页面 bridge 中的字段，但不虚构缺失字段。',
    '这两个端点**没有浏览器基准**，参数形状来自固定检出源码（conventions 第 31 条：无基准的契约只能算推断）。',
    '尚未在真实测试环境执行过新建/修改（写操作闭环未做）。',
  ],
}

const levelActionContext: Context = {
  pagePath: STUDY_TEACHER_LEVEL_PAGE_PATH,
  permission: '/dashboard/base/teacher-level',
  moduleType: STUDY_TEACHER_MODULE_TYPE,
  boundaries: [
    `覆盖 Portal 讲师类型页 ${STUDY_TEACHER_LEVEL_PAGE_PATH} 的启停与删除动作；权限是 /dashboard/base/teacher-level，使用 smart-layer-admin 实例并发送 module-type=${STUDY_TEACHER_MODULE_TYPE}。`,
    '启停接口是 POST JSON，删除接口虽然是 GET 但会真实删除类型；两者都属于写操作，不能当成只读查询。',
    'ID 必须来自当前讲师类型列表；删除没有页面撤销接口，提交前取消只能丢弃本地草稿。',
  ],
  prerequisites: [
    '使用当前用户、当前租户的会话 token 创建 SDK，并为 smart-layer-admin 配置 baseURL。',
    '从 study-teacher-level-list 保留目标行的 id 与当前 status，写后重新读取列表确认结果。',
  ],
  evidence: levelContext.evidence,
  gaps: levelContext.gaps,
}


/**
 * 教师类型字典：两个页面上都发（讲师管理列表页与讲师管理表单页），
 * 都是 `smartLayerAdminHttp.get('/dict/selectByPage.lay', {params: {type: 'teacher_type', page: 1, pageSize: -1}})`。
 */
const teacherTypeDictContext: Context = {
  pagePath: STUDY_TEACHER_PAGE_PATH,
  permission: '/dashboard/base/teacher',
  moduleType: STUDY_TEACHER_MODULE_TYPE,
  boundaries: [
    `覆盖 Portal 讲师管理页 ${STUDY_TEACHER_PAGE_PATH}（列表页与表单页都会发）读取教师类型字典；权限是 /dashboard/base/teacher，走 smart-layer-admin 实例。`,
    `端点是 GET ${STUDY_TEACHER_TYPE_DICT_PATH}，三个参数（type=${STUDY_TEACHER_TYPE_DICT_TYPE}、page=1、pageSize=-1）都由页面写死，SDK 不开放调用方改写。`,
    '这一条请求在页面上**不带 isOriginal**，是靠实例拦截器判 code 的；而页面上下文在接线处被配成 isOriginal:true，所以 SDK 自己补了 code 判定。',
    '它不是「讲师类型管理页」的那张表：那个是 study-teacher-level-list（/manage/study/teacherlevelmanagement.lay）。',
  ],
  prerequisites: [
    '使用当前用户、当前租户的会话 token 创建 SDK，并拥有讲师管理页权限。',
    'smart-layer-admin 实例的 baseURL 必须由调用方在 httpBaseUrls 里显式给出，否则 SDK 失败关闭、不发请求（conventions 第 27 条）。',
  ],
  evidence: [
    {
      source: 'CodeReview_Projects_Js@test/portal/main:82651c98c5 app/portal/views/dashboard/education/base/teacher/list.vue（141-153 行）与 teacher/[mode]/[id].vue（199-211 行）',
      kind: 'reference',
      note: '两处调用逐字一致：type=teacher_type、page=1、pageSize=-1，并把 results 映射成 {value: Number(item.value), label: item.label}；固定检出源码证据，未在真实环境调用。',
    },
    {
      source: 'src/capabilities/study-teacher.ts',
      kind: 'implementation',
      note: '锁定固定参数、results 的两种响应形状容忍与 code 判定；未覆盖 smart-layer 后端的分页上限语义。',
    },
  ],
  gaps: [
    '响应里 results 的位置（顶层 vs 包络里的 data.results）**未在真实环境核实**：页面上下文被配成 isOriginal 时拿到的是原始体，SDK 两种都认。',
    '这个端点没有浏览器基准。',
    '字典项除 value/label 之外的字段（如 id、排序）未纳入契约。',
  ],
}

/** 评价设置页（无子路由，保存就是这一页底部的表单） */
const appraiseContext: Context = {
  pagePath: STUDY_APPRAISE_SETTING_PAGE_PATH,
  permission: '/dashboard/base/teacher-appraise-setting',
  moduleType: STUDY_TEACHER_MODULE_TYPE,
  boundaries: [
    `覆盖 Portal 评价设置页 ${STUDY_APPRAISE_SETTING_PAGE_PATH} 的题目保存；权限是 /dashboard/base/teacher-appraise-setting，走 platform 实例。`,
    `端点是 POST ${STUDY_APPRAISE_SETTING_SAVE_PATH}，body 是题目**数组**；后端整份替换（把现有题目全部 is_del=1 后重插），不是增量保存。`,
    '这一页还有一块「评价等级说明/分值」的表格，它编辑的是**字典**（`/sys/dict/data/updateList`），不是评价设置题目 —— 本能力不覆盖字典那一块。',
  ],
  prerequisites: [
    '使用当前用户、当前租户的会话 token 创建 SDK，并拥有评价设置页权限。',
    '读一次 study-appraise-setting-list 拿到当前题目，再在它的基础上增删改；否则整份替换会把没带上的题目删掉。',
  ],
  evidence: [
    {
      source: 'CodeReview_Projects_Js@test/portal/main:82651c98c5 app/portal/views/dashboard/education/base/teacher-appraise-setting/{list.vue,components/form.vue}',
      kind: 'reference',
      note: '确认保存请求的 URL、POST 方法、数组 body 与 `sort: index + 1` 重排；确认页面规则（required / max 100 / validateOnlySpace）与「新增一项」到 5 就停；固定检出源码证据，未在真实环境调用。',
    },
    {
      source: 'CodeReview_Mall_Platform_Java@test/test:998ce8223fa StudyAppraiseTeacherController#save、StudyAppraiseTeacherServiceImpl#saveInfo',
      kind: 'reference',
      note: '确认 3~5 条的硬限制、先软删现有题目再插新、以及只读 sort/content 两个字段；未在真实环境执行写操作。',
    },
  ],
  gaps: [
    '保存端点**没有浏览器基准**，body 形状来自源码与后端实现；页面把读回来的整行一起回传，SDK 只发 {sort, content} 是基于后端只读这两个字段的静态结论。',
    '尚未在真实测试环境执行 prepare→submit→回查的完整写闭环。',
    '「评价等级说明/分值」那一块编辑走字典接口（/sys/dict/data/updateList），不在本能力范围内。',
  ],
}

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

  'study-teacher-prepare-save': base(
    'study-teacher-prepare-save',
    '按 Portal 讲师主体表单规则校验并生成保存草稿；只做本地准备，不发送请求。',
    'prepare',
    teacherFormInput,
    { shape: '{ draft: { mode, professor, videoIds } }', fields: [field('$', 'object', '本地讲师保存草稿。'), field('draft', 'object', '供 study-teacher-save 使用的草稿。'), field('draft.professor', 'object', '去掉 mode、videoIds、createTime、lastUpdateTime 后的讲师字段。'), field('draft.videoIds', 'object[] | null', '视频 ID 数组；没有时为 null。', { nullable: true, nullMeaning: '页面没有视频' })], empty: '表单字段、ID 或 videoIds 非法时抛错，不发请求。' },
    ['把草稿中的完整讲师字段展示给用户确认；staffCode 为空时明确提示保存会先创建外部讲师学员记录。', '用户取消时调用本地 cancel 能力，不触发任何写请求。'],
    [
      { role: 'required', when: '用户确认保存', capabilityId: 'study-teacher-save', mapping: { draft: 'result.draft' }, instruction: '原样提交同一份讲师草稿。' },
      { role: 'cancel', when: '用户取消保存', capabilityId: 'study-teacher-cancel-save', mapping: {}, instruction: '只丢弃本地草稿。' },
    ],
    '得到通过 Portal 表单校验、尚未产生服务端副作用的讲师保存草稿。',
    teacherManagementContext,
  ),
  'study-teacher-save': base(
    'study-teacher-save',
    '保存讲师主体；按 Portal create/edit 分支提交 professor 与 videoIds，必要时先创建外部讲师学员。',
    'write',
    { draft: input('study-teacher-prepare-save 返回的完整草稿。', 'study-teacher-prepare-save.result.draft', { type: 'object' }) },
    voidOutput,
    [
      '创建且 staffCode 缺失时，SDK 先 POST saveTeacher，再把返回 staffCode 放进 professor 后 POST addProfessorStudy；已有 staffCode 或编辑态不会创建学员。',
      '请求成功、超时或响应不确定后，按同一 name/staffCode 回查 study-teacher-list；若先建学员后主体保存失败，必须报告部分副作用。',
    ],
    [
      { role: 'recovery', when: '请求成功、超时或响应不确定', capabilityId: 'study-teacher-list', mapping: {}, instruction: '回查讲师列表确认主体字段；外部讲师分支还要核对返回的 staffCode。' },
      { role: 'cancel', when: '用户尚未确认而放弃草稿', capabilityId: 'study-teacher-cancel-save', mapping: {}, instruction: '提交前取消只丢弃草稿；任何已发请求都没有撤销能力。' },
    ],
    '讲师列表回查确认主体字段与草稿一致后，才能报告保存完成；只拿到 HTTP 成功不算。',
    teacherManagementContext,
    { idempotency: '端点没有 requestId；编辑是绝对值保存，创建外部讲师可能先产生 staffCode。超时必须先回查，不能盲目重试。' },
  ),
  'study-teacher-cancel-save': base(
    'study-teacher-cancel-save',
    '取消尚未提交的讲师主体保存草稿。',
    'local',
    {},
    cancelOutput,
    ['丢弃本地讲师草稿；不能回滚已创建的学员或已提交的讲师主体。'],
    [],
    '返回 cancelled=true 且不发请求。',
    teacherManagementContext,
  ),
  'study-teacher-prepare-status': base(
    'study-teacher-prepare-status',
    '按当前讲师列表行准备启停状态草稿，不发送请求。',
    'prepare',
    teacherStatusInput,
    { shape: '{ draft: { id, status } }', fields: [field('$', 'object', '本地状态草稿。'), field('draft.id', 'string | number', '讲师主体 ID。'), field('draft.status', '0 | 1', '目标状态。')], empty: 'ID 非法或 currentStatus 不是 0/1 时抛错。' },
    ['展示当前状态和目标状态；用户取消时调用 cancel。'],
    [{ role: 'required', when: '用户确认启停', capabilityId: 'study-teacher-status', mapping: { draft: 'result.draft' }, instruction: '原样提交状态草稿。' }, { role: 'cancel', when: '用户取消', capabilityId: 'study-teacher-cancel-status', mapping: {}, instruction: '只丢弃草稿。' }],
    '得到尚未产生服务端副作用的状态草稿。',
    teacherManagementContext,
  ),
  'study-teacher-status': base(
    'study-teacher-status',
    `变更讲师状态：GET ${STUDY_TEACHER_STATUS_PATH} 携带 id 与目标 status；虽然是 GET，但 Portal 将其作为写操作。`,
    'write',
    teacherStatusDraftInput,
    voidOutput,
    ['请求完成或超时后按同一 ID 回查 study-teacher-list，确认 status 已变成目标值。'],
    [{ role: 'required', when: '请求完成、超时或响应不确定', capabilityId: 'study-teacher-list', mapping: {}, instruction: '回查同一讲师 ID 的 status。' }, { role: 'cancel', when: '用户尚未确认而放弃', capabilityId: 'study-teacher-cancel-status', mapping: {}, instruction: '提交前取消不发 GET。' }],
    '讲师列表回查确认目标状态后，才能报告启停完成。',
    teacherManagementContext,
    { idempotency: writeIdempotency },
  ),
  'study-teacher-cancel-status': base(
    'study-teacher-cancel-status',
    '取消尚未提交的讲师启停草稿。',
    'local',
    {},
    cancelOutput,
    ['丢弃本地状态草稿；不能撤销已发出的 GET 写请求。'],
    [],
    '返回 cancelled=true 且不发请求。',
    teacherManagementContext,
  ),
  'study-teacher-prepare-remove': base(
    'study-teacher-prepare-remove',
    '按当前讲师列表准备删除讲师 ID 数组，不发送 DELETE。',
    'prepare',
    { ids: input('待删除讲师 ID 数组。', 'study-teacher-list.result.list[].id', { type: '(string | number)[]', constraints: ['非空数组', '每个 ID 为正整数'] }) },
    idsOutput('讲师删除的本地 ID 草稿。'),
    ['向用户展示讲师姓名、ID及删除影响后确认；取消时调用 cancel。'],
    [{ role: 'required', when: '用户确认删除', capabilityId: 'study-teacher-remove', mapping: { ids: 'result.ids' }, instruction: '原样提交同一 ID 数组。' }, { role: 'cancel', when: '用户取消', capabilityId: 'study-teacher-cancel-remove', mapping: {}, instruction: '只丢弃 ID。' }],
    '得到经过本地 ID 校验、尚未产生删除副作用的草稿。',
    teacherManagementContext,
  ),
  'study-teacher-remove': base(
    'study-teacher-remove',
    `删除讲师主体：DELETE ${STUDY_TEACHER_DELETE_PATH}，body为裸讲师ID数组。`,
    'write',
    { ids: input('prepare 返回的讲师 ID 数组。', 'study-teacher-prepare-remove.result.ids', { type: '(string | number)[]' }) },
    voidOutput,
    ['请求完成、超时或响应不确定后按同一 ID 回查 study-teacher-list；不要用 HTTP 成功代替删除确认。'],
    [{ role: 'required', when: '用户确认且已有 prepare 结果', capabilityId: 'study-teacher-remove', mapping: { ids: 'args.ids' }, instruction: '发送 platform DELETE 裸数组。' }, { role: 'recovery', when: '请求成功、超时或响应不确定', capabilityId: 'study-teacher-list', mapping: {}, instruction: '按 ID 回查讲师列表。' }, { role: 'cancel', when: '提交前取消', capabilityId: 'study-teacher-cancel-remove', mapping: {}, instruction: '只丢弃草稿。' }],
    '讲师列表回查确认目标 ID 不再可见后，才能报告删除完成。',
    teacherManagementContext,
    { idempotency: writeIdempotency },
  ),
  'study-teacher-cancel-remove': base(
    'study-teacher-cancel-remove',
    '取消尚未提交的讲师删除草稿。',
    'local',
    {},
    cancelOutput,
    ['丢弃本地 ID；不能撤销已发送的 DELETE。'],
    [],
    '返回 cancelled=true 且不发请求。',
    teacherManagementContext,
  ),

  'study-teacher-level-prepare-status': base(
    'study-teacher-level-prepare-status',
    '按当前讲师类型列表准备启停状态草稿，不发送请求。',
    'prepare',
    levelStatusInput,
    { shape: '{ draft: { id, status } }', fields: [field('$', 'object', '本地状态草稿。'), field('draft.id', 'string | number', '讲师类型 ID。'), field('draft.status', '0 | 1', '目标状态。')], empty: 'ID 非法或 currentStatus 不是 0/1 时抛错。' },
    ['展示当前状态和目标状态；用户取消时调用 cancel。'],
    [{ role: 'required', when: '用户确认启停', capabilityId: 'study-teacher-level-status', mapping: { draft: 'result.draft' }, instruction: '原样提交状态草稿。' }, { role: 'cancel', when: '用户取消', capabilityId: 'study-teacher-level-cancel-status', mapping: {}, instruction: '只丢弃草稿。' }],
    '得到尚未产生服务端副作用的讲师类型状态草稿。',
    levelActionContext,
  ),
  'study-teacher-level-status': base(
    'study-teacher-level-status',
    `变更讲师类型状态：POST ${STUDY_TEACHER_LEVEL_STATUS_PATH}，JSON body为 id 与目标 status。`,
    'write',
    levelStatusDraftInput,
    voidOutput,
    ['请求完成、超时或响应不确定后按同一 ID 回查 study-teacher-level-list，确认 status 已变更。'],
    [{ role: 'required', when: '请求完成、超时或响应不确定', capabilityId: 'study-teacher-level-list', mapping: {}, instruction: '回查同一讲师类型 ID。' }, { role: 'cancel', when: '提交前取消', capabilityId: 'study-teacher-level-cancel-status', mapping: {}, instruction: '只丢弃草稿。' }],
    '讲师类型列表回查确认目标状态后，才能报告启停完成。',
    levelActionContext,
    { idempotency: writeIdempotency },
  ),
  'study-teacher-level-cancel-status': base(
    'study-teacher-level-cancel-status',
    '取消尚未提交的讲师类型启停草稿。',
    'local',
    {},
    cancelOutput,
    ['丢弃本地状态草稿；不能撤销已发出的 POST。'],
    [],
    '返回 cancelled=true 且不发请求。',
    levelActionContext,
  ),
  'study-teacher-level-prepare-remove': base(
    'study-teacher-level-prepare-remove',
    '按当前讲师类型列表准备删除目标 ID，不发送 GET。',
    'prepare',
    { id: input('待删除讲师类型 ID。', 'study-teacher-level-list.result.list[].id', { type: 'string | number' }) },
    { shape: '{ id: string | number }', fields: [field('$', 'object', '本地删除草稿。'), field('id', 'string | number', '讲师类型 ID。')], empty: 'ID 非法时抛错。' },
    ['向用户展示类型名称和 ID 后确认；取消时调用 cancel。'],
    [{ role: 'required', when: '用户确认删除', capabilityId: 'study-teacher-level-remove', mapping: { id: 'result.id' }, instruction: '原样提交 ID。' }, { role: 'cancel', when: '用户取消', capabilityId: 'study-teacher-level-cancel-remove', mapping: {}, instruction: '只丢弃 ID。' }],
    '得到经过本地 ID 校验、尚未产生删除副作用的草稿。',
    levelActionContext,
  ),
  'study-teacher-level-remove': base(
    'study-teacher-level-remove',
    `删除讲师类型：GET ${STUDY_TEACHER_LEVEL_DELETE_PATH}?id=...；虽然是 GET，但会真实删除记录。`,
    'write',
    { id: input('prepare 返回的讲师类型 ID。', 'study-teacher-level-prepare-remove.result.id', { type: 'string | number' }) },
    voidOutput,
    ['请求完成、超时或响应不确定后按同一 ID 回查 study-teacher-level-list；不要用 HTTP 成功代替删除确认。'],
    [{ role: 'required', when: '用户确认且已有 prepare 结果', capabilityId: 'study-teacher-level-remove', mapping: { id: 'args.id' }, instruction: '发送 smart-layer-admin GET query.id。' }, { role: 'recovery', when: '请求成功、超时或响应不确定', capabilityId: 'study-teacher-level-list', mapping: {}, instruction: '按 ID 回查讲师类型列表。' }, { role: 'cancel', when: '提交前取消', capabilityId: 'study-teacher-level-cancel-remove', mapping: {}, instruction: '只丢弃草稿。' }],
    '讲师类型列表回查确认目标 ID 不再可见后，才能报告删除完成。',
    levelActionContext,
    { idempotency: writeIdempotency },
  ),
  'study-teacher-level-cancel-remove': base(
    'study-teacher-level-cancel-remove',
    '取消尚未提交的讲师类型删除草稿。',
    'local',
    {},
    cancelOutput,
    ['丢弃本地 ID；不能撤销已发送的 GET 删除请求。'],
    [],
    '返回 cancelled=true 且不发请求。',
    levelActionContext,
  ),

  // -------------------------------------------------------------------------
  // 本轮补齐：人员候选、教师类型字典、讲师类型写入口、评价设置保存
  // -------------------------------------------------------------------------

  'study-teacher-candidate-student-list': base(
    'study-teacher-candidate-student-list',
    `查询讲师管理表单「讲师姓名」下拉的候选：**还不是讲师**的学员列表（GET ${STUDY_TEACHER_CANDIDATE_STUDENT_PATH}，走 platform 实例）。`,
    'read',
    {},
    {
      shape: 'object[]',
      fields: [
        field('$', 'object[]', '候选学员数组；**这不是分页结构**（该端点没有 pageNo/pageSize，页面直接对数组 map）。'),
        field('[]', 'object', '一名候选学员。'),
        field('[].staffCode', 'string | number | null', '学员工号；表单选中后就是讲师的 staffCode（**不是** sys_user.id）。Java Long 可能序列化成字符串，按原样保留。', { nullable: true, nullMeaning: '后端未返回' }),
        field('[].name', 'string | null', '学员姓名；下拉的显示文本。', { nullable: true, nullMeaning: '后端未返回' }),
      ],
      empty: '[] 表示当前租户没有「还没有对应讲师」的学员；响应不是数组会抛错，不降级为空候选。',
    },
    [
      '把 list[].staffCode 作为讲师表单的 staffCode、list[].name 作为显示文本；这两个字段之外的学员数据本能力不返回（页面不消费）。',
      '候选是「所有还不是讲师的学员」，**没有关键字入口**（后端方法无参数）：要精确找某个人用 base-user-search（按姓名/部门，返回 sys_user.id 而不是工号），两者不能互换。',
    ],
    [
      { role: 'optional', when: '用户在讲师新建表单选了某个候选且要创建讲师主体', capabilityId: 'study-teacher-save-teacher', instruction: '只有在所选候选的 staffCode 为空、需要先建外部讲师学员记录时才走 saveTeacher；正常候选已有 staffCode，讲师主体保存走 /manage/addProfessorStudy.lay（本能力族不覆盖）。' },
    ],
    '返回当前租户「还不是讲师的学员」候选；读取本身不创建或修改讲师。',
    teacherCandidateContext,
    { failures: [
      '响应不是数组会抛错（页面直接对结果 map）：不把形状变化降级成"没有候选"。',
      '401/403、缺 baseURL、网络错误原样抛出；只读查询可重试，但要保留同一份候选口径。',
    ] },
  ),

  'study-teacher-type-dict': base(
    'study-teacher-type-dict',
    `查询教师类型字典（GET ${STUDY_TEACHER_TYPE_DICT_PATH}?type=${STUDY_TEACHER_TYPE_DICT_TYPE}，smart-layer-admin 实例，固定 page=1&pageSize=-1）。`,
    'read',
    {},
    {
      shape: 'object[]',
      fields: [
        field('$', 'object[]', '教师类型字典项数组。'),
        field('[]', 'object', '一个字典项。'),
        field('[].value', 'string', '字典值**原样字符串**；Portal 页面对它再做 Number(...)，SDK 不改写。表单提交时这个值就是讲师类型的 level。'),
        field('[].label', 'string', '字典显示文本；页面把它填进 a-select 的 label。'),
      ],
      empty: '[] 表示字典里没有教师类型；响应里没有 results 数组会抛错，不降级为空列表。',
    },
    [
      '用 list[].value 作为讲师类型下拉的取值、list[].label 作为显示文本；不要自行把 value 映射成"第 1 类/第 2 类"。',
      '这不是「讲师类型管理页」的数据源：那个是 `study-teacher-level-list`（另一张表，字段是 name/level/sort/status）。两者不可互相顶替。',
    ],
    [],
    '返回教师类型字典项；读取本身不修改任何配置。',
    teacherTypeDictContext,
    { failures: [
      '响应里没有 results 数组会抛错：不把它降级成空的类型列表（那会被读成"这个租户没有教师分类"）。',
      'smart-layer 业务失败（code≠200）会抛错：SDK 自己补了这一判，因为页面此时拿到的是原始响应体。',
      '401/403、缺 baseURL、网络错误原样抛出；只读查询可重试。',
    ] },
  ),

  'study-teacher-level-prepare-save': base(
    'study-teacher-level-prepare-save',
    '按 Portal 讲师类型表单规则校验名称、类型与排序，并**按 create/edit 分支选好端点**，生成尚未提交的保存草稿。',
    'prepare',
    {
      form: input('讲师类型表单对象。', 'Portal 讲师类型表单页 [mode]/[id].vue 的 formState', {
        type: '{ mode: "create" | "edit", id?: string | number, name: string, level: number, sort: number }',
        constraints: [
          'name 必填、最多 10 个字符、不能全是空格（页面 rules.name 的三条）。',
          'level 必须是 1~99 的整数（页面 a-input-number 的 min/max + precision=0）。',
          'sort 必须是 1~999 的整数（同上）。',
          'mode=create 不允许带 id；mode=edit 必须带 id。',
        ],
      }),
      'form.mode': input('保存分支：create 打 insertTeacherLevel.lay，edit 打 updateTeacherLevel.lay。', '页面按 rrForm.isCreateMode 自动决定', { type: '"create" | "edit"', options: [{ value: 'create', label: '新建' }, { value: 'edit', label: '修改' }] }),
      'form.id': input('讲师类型记录 ID；edit 分支必填，来自讲师类型列表行。', 'study-teacher-level-list.result.list[].id', { type: 'string | number', required: false, requiredWhen: 'mode=edit 时必填；mode=create 时不允许出现', nullable: true, nullMeaning: '新建态没有该字段' }),
      'form.name': input('类型名称。', '用户在讲师类型表单里填写的类型名称', { type: 'string', format: '非空、≤10 字、不能全是空格' }),
      'form.level': input('类型（1~99 的整数）。⚠️ 编辑态页面上这个输入框是 disabled 的，改不了，但页面仍会原样回传。', '讲师类型表单的「类型」输入框', { type: 'integer', unit: '无（按原值发送的等级序号）' }),
      'form.sort': input('排序（1~999 的整数）。', '讲师类型表单的「排序」输入框', { type: 'integer' }),
    },
    {
      shape: '{ draft: { mode, url, body } }',
      fields: [
        field('$', 'object', '本地准备结果；只做校验与端点选择，没有写入服务端。'),
        field('draft', 'object', '供 study-teacher-level-save 使用的草稿。'),
        field('draft.mode', '"create" | "edit"', '保存分支，与传入的 form.mode 一致。', { values: { create: '新建', edit: '修改' } }),
        field('draft.url', 'string', `实际要 POST 的路径：create → ${STUDY_TEACHER_LEVEL_CREATE_PATH}；edit → ${STUDY_TEACHER_LEVEL_UPDATE_PATH}。`),
        field('draft.body', 'object', '实际要发送的 JSON body；键序 name, level, sort，编辑态在**最前面**多一个 id。'),
        field('draft.body.id', 'string | number', '讲师类型记录 ID；只在 edit 分支出现。', { optional: true, nullable: false }),
        field('draft.body.name', 'string', '类型名称（已 trim）。'),
        field('draft.body.level', 'integer', '类型值。'),
        field('draft.body.sort', 'integer', '排序值。'),
      ],
      empty: '名称、类型、排序或 mode/id 组合不符合规则时在发请求前抛错，不返回空草稿。',
    },
    [
      '把 draft.url 与 draft.body 一起展示给用户确认：用户要能看出这次是「新建」还是「修改」哪一条。',
      'level 在编辑态改不了：如果用户想改类型值，只能停用/删除后新建（页面就是这么限制的）。',
    ],
    [
      { role: 'required', when: '用户确认保存且草稿仍有效', capabilityId: 'study-teacher-level-save', mapping: { draft: 'result.draft' }, instruction: '原样提交完整 draft（含 mode 与 url），不要自己换端点或删掉 id。' },
    ],
    '得到通过 Portal 表单规则、且端点已按 create/edit 选定的本地草稿；服务端尚未改变。',
    levelContext,
    { failures: [
      '名称超 10 字、类型不在 1~99、排序不在 1~999、mode 与 id 不匹配，都会在发请求前抛错。',
      'prepare 不发起任何网络请求；它失败时不要改用 save 直接提交未校验的字段。',
    ] },
  ),

  'study-teacher-level-save': base(
    'study-teacher-level-save',
    `保存讲师类型（**写操作**）：按草稿的 mode POST ${STUDY_TEACHER_LEVEL_CREATE_PATH} 或 ${STUDY_TEACHER_LEVEL_UPDATE_PATH}。`,
    'write',
    {
      draft: input('study-teacher-level-prepare-save 返回的完整草稿；mode 与 url 必须自洽。', 'study-teacher-level-prepare-save.result.draft', {
        type: '{ mode: "create" | "edit", url: string, body: { id?: string | number, name: string, level: number, sort: number } }',
        constraints: ['mode=create 时 url 必须是 insertTeacherLevel.lay，mode=edit 时必须是 updateTeacherLevel.lay；不自洽会被 SDK 拒绝。'],
      }),
      'draft.url': input('要 POST 的路径；由 prepare 按 mode 选定。', 'study-teacher-level-prepare-save.result.draft.url', { type: 'string', constraints: [`只接受 ${STUDY_TEACHER_LEVEL_CREATE_PATH} 与 ${STUDY_TEACHER_LEVEL_UPDATE_PATH} 两个值。`] }),
      'draft.body': input('提交体；提交前 SDK 会用与 prepare 相同的规则重新校验一遍。', 'study-teacher-level-prepare-save.result.draft.body', { type: 'object' }),
    },
    {
      shape: 'void',
      fields: [field('$', 'void', 'SDK 不返回业务数据：Portal 保存成功后只弹提示，不读响应体。')],
      empty: '业务失败（smart-layer code≠200）会抛错；成功没有返回值，必须按 steps 回查。',
    },
    [
      '提交前把 draft.body 与"新建/修改"方向展示给用户；写的是绝对值，不需要先读当前值。',
      '⚠️ SDK 会**自己判一次 smart-layer 的 code**：讲师两页的页面上下文在接线处被配成了 isOriginal:true，而实例拦截器在 isOriginal 下不看 code —— 不补这一判，业务失败会以"成功的 undefined"返回。',
      '端点没有 requestId：insert 重发会建出第二条同名类型，超时先回查再决定。',
    ],
    [
      { role: 'required', when: '请求完成或超时', capabilityId: 'study-teacher-level-list', instruction: '按 page 回查讲师类型列表，核对 name/level/sort 与记录条数；新建时"条数 +1 且出现该 name"才算成功，不能只看请求没抛错。' },
    ],
    '讲师类型列表回查确认目标记录已出现（新建）或字段已更新（修改）后，才能报告保存完成。',
    levelContext,
    {
      failures: [
        '草稿的 url 与 mode 不自洽、或 body 里的 name/level/sort 不符合页面规则，会在发请求前抛错。',
        'smart-layer 业务失败（code≠200）会抛错：页面上下文在接线处被配成 isOriginal，实例拦截器不判 code，所以 SDK 自己补了这一判；不补的话业务失败会以"成功的 void"返回。',
        '401/403、缺 baseURL、网络错误原样抛出；写操作超时后先回查列表（新建可能已经写进去了），不要盲目重发。',
      ],
      idempotency: '端点没有 requestId 或其它防重键；修改写的是绝对值、重发终态相同，但新建重发会多出一条记录 —— 超时先回查列表，确认没有再重发。',
    },
  ),

  'study-appraise-setting-prepare-save': base(
    'study-appraise-setting-prepare-save',
    '按 Portal 评价设置表单规则校验题目数组（3~5 条、每题必填且 ≤100 字），并按数组顺序重排题号，生成尚未提交的草稿。',
    'prepare',
    {
      items: input('题目数组，**顺序即题号**。', '用户在评价设置页编辑的题目列表', {
        type: '{ content: string, sort?: number }[]',
        constraints: ['条数 3~5（后端 saveInfo 的硬限制）', '每条 content 必填、不能全是空格、≤100 字', '调用方给的 sort 会被忽略并按下标重排为 1..N'],
      }),
      'items[].content': input('题干文本。', '评价设置页每行的输入框', { type: 'string', format: '非空、≤100 字、不能全是空格' }),
      'items[].sort': input('题号；**不要自己填**，提交时按数组下标重排。', '评价设置页的行顺序', { type: 'integer', required: false, omitted: '按数组下标重排为 1..N' }),
    },
    {
      shape: '{ draft: { items: { sort, content }[] } }',
      fields: [
        field('$', 'object', '本地准备结果；只做校验与题号重排，没有写入服务端。'),
        field('draft', 'object', '供 study-appraise-setting-save 使用的草稿。'),
        field('draft.items', 'object[]', '已重排题号的题目数组；提交时作为 JSON **数组** body 发送。'),
        field('draft.items[].sort', 'integer', '题号 1..N，按数组顺序重排（与页面 onSubmit 的 `sort: index + 1` 一致）。'),
        field('draft.items[].content', 'string', '题干（已 trim）。'),
      ],
      empty: '条数不在 3~5、或某条 content 为空/超长时在发请求前抛错，不返回空草稿。',
    },
    [
      '把重排后的题号展示给用户：页面上的上下移动按钮只改变数组顺序，题号是提交时现算的。',
      '条数上限 5 同时来自页面（「新增一项」到 5 就停）与后端（>5 报「题目不能多于5个」）；下限 3 只来自后端 —— 页面允许删到 1 条，那时保存会失败，所以 SDK 提前挡住。',
    ],
    [
      { role: 'required', when: '用户确认保存', capabilityId: 'study-appraise-setting-save', mapping: { draft: 'result.draft' }, instruction: '原样提交 draft；不要包成 { items: [...] }，也不要只提交改动的那几条。' },
    ],
    '得到题号已重排、尚未写入的本地草稿；服务端题目未改变。',
    appraiseContext,
    { failures: [
      '题目条数不在 3~5、或某条题干为空/超长，会在发请求前抛错（后端对条数也有同样的硬校验）。',
      'prepare 不发起任何网络请求；它失败时不要绕过校验直接提交。',
    ] },
  ),

  'study-appraise-setting-save': base(
    'study-appraise-setting-save',
    `保存讲师评价设置题目（**写操作**）：POST ${STUDY_APPRAISE_SETTING_SAVE_PATH}，body 是题目**数组**；后端整份替换（先把现有题目置 is_del=1 再重插）。`,
    'write',
    {
      draft: input('study-appraise-setting-prepare-save 返回的草稿；提交前 SDK 用同一套规则重新校验。', 'study-appraise-setting-prepare-save.result.draft', { type: '{ items: { sort, content }[] }' }),
      'draft.items': input('题目数组（3~5 条）。**必须包含全部要保留的题目** —— 这是整份替换，不是增量。', 'study-appraise-setting-prepare-save.result.draft.items', { type: 'object[]', constraints: ['非空、3~5 条'] }),
    },
    {
      shape: 'void',
      fields: [field('$', 'void', 'SDK 不返回业务数据：Portal 保存成功后只弹「保存成功」，不读响应体。')],
      empty: '请求失败（含后端条数/内容校验）会抛错；成功没有返回值，必须按 steps 回查。',
    },
    [
      '⚠️ **整份替换**：只提交要保留的那几条；漏掉的题目会被后端置 is_del=1（下一次 list 就看不到）。所以在提交前，draft.items 必须是"保存后想要的完整题目列表"。',
      '请求体是**数组**（`[{sort, content}, …]`），不是 `{ items: [...] }`；SDK 只发这两个字段 —— 页面会把读回来的整行（id/isDel/createTime 等）一起回传，而后端 saveInfo 只读 sort 与 content。',
      '保存成功后再读一次 `study-appraise-setting-list` 才算确认；返回的题目顺序可能与提交顺序不同（后端按 sort 展示）。',
    ],
    [
      { role: 'required', when: '请求完成或超时', capabilityId: 'study-appraise-setting-list', instruction: '回查题目列表：条数、题干文本与顺序都要与草稿一致；条数不对说明这次替换把某些题目删掉了（或没删掉）。' },
    ],
    '评价设置列表回查确认题目条数与文本跟草稿一致后，才能报告保存完成；只看到请求没抛错不算。',
    appraiseContext,
    {
      failures: [
        '草稿条数不在 3~5、或某条题干为空/超长，会在发请求前抛错（后端 saveInfo 有同样的条数硬校验）。',
        '后端业务失败（含条数/内容校验）原样抛出；不要把它当成保存成功。',
        '401/403 与网络错误原样抛出；保存后必须回查列表 —— 条数少了说明整份替换把没带上的题目删掉了，要按原样补回。',
      ],
      idempotency: '端点没有 requestId；同一份载荷重发终态相同（整份替换），但**漏发条目**与**重复提交**的后果不同方向 —— 超时后先回查列表再决定是否重发。',
    },
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
  'study-teacher-prepare-save': 'studyTeacher.prepareSave',
  'study-teacher-save': 'studyTeacher.save',
  'study-teacher-cancel-save': 'studyTeacher.cancelSave',
  'study-teacher-prepare-status': 'studyTeacher.prepareStatus',
  'study-teacher-status': 'studyTeacher.setStatus',
  'study-teacher-cancel-status': 'studyTeacher.cancelStatus',
  'study-teacher-prepare-remove': 'studyTeacher.prepareRemove',
  'study-teacher-remove': 'studyTeacher.remove',
  'study-teacher-cancel-remove': 'studyTeacher.cancelRemove',
  'study-teacher-candidate-student-list': 'studyTeacher.listCandidateStudents',
  'study-teacher-type-dict': 'studyTeacher.listTeacherTypes',
  'study-teacher-level-prepare-save': 'studyTeacher.prepareSaveLevel',
  'study-teacher-level-save': 'studyTeacher.saveLevel',
  'study-teacher-level-prepare-status': 'studyTeacher.prepareLevelStatus',
  'study-teacher-level-status': 'studyTeacher.setLevelStatus',
  'study-teacher-level-cancel-status': 'studyTeacher.cancelLevelStatus',
  'study-teacher-level-prepare-remove': 'studyTeacher.prepareRemoveLevel',
  'study-teacher-level-remove': 'studyTeacher.removeLevel',
  'study-teacher-level-cancel-remove': 'studyTeacher.cancelRemoveLevel',
  'study-appraise-setting-prepare-save': 'studyTeacher.prepareSaveAppraiseSetting',
  'study-appraise-setting-save': 'studyTeacher.submitAppraiseSetting',
} as const

export const STUDY_GRADE_TEACHER_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.keys(METHOD_PATHS).map(id => [id, contracts[id]!]),
)

export const STUDY_GRADE_TEACHER_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(METHOD_PATHS).map(([id, methodPath]) => [methodPath, STUDY_GRADE_TEACHER_AI_CONTRACTS[id]!]),
)
