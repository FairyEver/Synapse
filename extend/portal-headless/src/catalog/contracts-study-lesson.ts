import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  STUDY_LESSON_HIDDEN_METHODS,
  STUDY_LESSON_METHODS,
  studyLessonActionCapabilities,
  studyLessonCapabilities,
  studyLessonHiddenCapabilities,
} from '../capabilities/study-lesson.js'

type LessonKind = 'daily' | 'weekly' | 'monthly'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const actionDefinitions = new Map(studyLessonActionCapabilities.map(definition => [definition.id, definition]))
const listDefinitions = new Map(studyLessonCapabilities.map(definition => [definition.id, definition]))
const allDefinitions = new Map([...listDefinitions, ...actionDefinitions])

const pageMeta: Record<LessonKind, { label: string; pagePath: string; permission: string }> = {
  daily: {
    label: '晨课堂',
    pagePath: '/dashboard/lesson/daily-lesson/list',
    permission: '/dashboard/lesson/daily-lesson',
  },
  weekly: {
    label: '周课堂',
    pagePath: '/dashboard/lesson/weekly-lesson/list',
    permission: '/dashboard/lesson/weekly-lesson',
  },
  monthly: {
    label: '月课堂',
    pagePath: '/dashboard/lesson/monthly-lesson/list',
    permission: '/dashboard/lesson/monthly-lesson',
  },
}

const commonBoundaries = [
  '所有能力都绑定到对应的晨/周/月课堂菜单页；Portal 的 module-type 推导为 12（学习管理），调用方不要自行改写或省略页面上下文。',
  '权限码分别为 /dashboard/lesson/daily-lesson、/dashboard/lesson/weekly-lesson、/dashboard/lesson/monthly-lesson；隐藏表单和学生页沿用列表页权限，不生成新的菜单权限。',
  '写操作必须按 prepare → submit → cancel 使用：prepare 只本地校验和整理草稿，submit 才发送 Portal 请求，cancel 只丢弃未提交草稿，不假装撤销已提交的后端副作用。',
  '能力保留 Portal 实际到达的字段和请求形状；没有把注释掉的学生入口、浏览器跳转或未绑定路由扩张成新的业务能力。',
]

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main@acab69a：app/portal/views/dashboard/education/lesson/{daily-lesson,weekly-lesson,monthly-lesson}/list.vue 及实际跳转的隐藏表单/学生/记录组件',
    kind: 'reference',
    note: '逐页核对三个菜单路径、按钮可达性、type=1/2/3、status/isRelGrade 门禁、表单字段、端点和请求体；注释掉的入口不计入范围。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test@0f1a557：StudyLessonController、StudyLessonRecordController、StudyLessonStudentRelController、StudyGradeController',
    kind: 'reference',
    note: '核对课堂详情/保存/删除/发布、记录、出勤、学生关系和月课堂班级辅助接口的 HTTP 路由、DTO 与服务端状态门禁；没有把源码静态证据冒充为写入成功。',
  },
  {
    source: 'src/capabilities/study-lesson.ts',
    kind: 'implementation',
    note: '核对 STUDY_LESSON_METHODS、studyLessonActionCapabilities、草稿转换、status/isRelGrade/isStart 门禁、module-type 页面上下文和本地 cancel 实现。',
  },
  {
    source: 'docs/pages/晨课堂.md、docs/pages/周课堂.md、docs/pages/月课堂.md、baseline/study-lesson.browser.json',
    kind: 'reference',
    note: '核对三页四件套、时间/字段差异、当前月课堂与 legacy 月课堂的端点区分以及历史列表基准；本节点不新增线上写冒烟。',
  },
  {
    source: 'test/study-lesson-actions.test.ts 及现有 study-lesson 定向测试',
    kind: 'test',
    note: '用于锁定请求路径、HTTP 方法、body/query 形状和非法门禁；离线断言不能替代真实测试环境的写入回查。',
  },
]

const writeEvidenceGaps = [
  '尚未在真实测试环境执行该能力的 prepare → submit → cancel 完整写入回查；Portal/Java 源码和离线测试已核对请求形状，但不能证明当前租户的后端最终业务效果。',
]

const hiddenReadEvidenceGaps = [
  '该隐藏学生/记录/辅助路由本节点未在真实测试环境重新读取；字段和请求形状来自固定 Portal/Java 检出、历史基准或离线测试，需主线按页面逐项补充线上证据。',
]

function lessonKindOf (id: string): LessonKind {
  if (id.includes('-daily-')) return 'daily'
  if (id.includes('-weekly-')) return 'weekly'
  return 'monthly'
}

function typeOfParam (kind: string): string {
  if (kind === 'array') return 'object[]'
  if (kind === 'number') return 'number'
  if (kind === 'boolean') return 'boolean'
  if (kind === 'enum') return 'string | number'
  if (kind === 'date') return 'string'
  if (kind === 'text' || kind === 'search' || kind === 'tree') return 'string'
  return 'object'
}

function inputsFor (id: string, overrides: Record<string, AiParameter> = {}): Record<string, AiParameter> {
  const definition = allDefinitions.get(id)
  if (!definition) throw new Error(`study-lesson 契约缺少能力定义：${id}`)
  const inputs: Record<string, AiParameter> = Object.fromEntries(definition.params.map(item => [item.name, param(
    item.description ?? `${item.name}；按 Portal 当前页面字段传入。`,
    item.lookup ? `对应候选入口 ${item.lookup.capabilityId} 的返回值；先取得候选再传入。` : `Portal ${pageMeta[lessonKindOf(id)].label} 页面参数或当前列表行。`,
    {
      type: typeOfParam(item.kind),
      required: item.required,
      ...(item.options ? { options: item.options } : {}),
      ...(item.options ? { constraints: item.options.map(option => `${String(option.value)}=${option.label}`) } : {}),
    },
  )]))
  return { ...inputs, ...overrides }
}

function draftPrepareId (submitId: string): string {
  if (submitId.includes('-student-move-out')) return submitId.replace('-student-move-out', '-student-prepare-move-out')
  if (submitId.includes('-student-batch-delete')) return submitId.replace('-student-batch-delete', '-student-prepare-batch-delete')
  if (submitId.endsWith('-attendance-save')) return submitId.replace('-attendance-save', '-prepare-attendance')
  if (submitId.endsWith('-save')) return submitId.replace(/-save$/, '-prepare-save')
  if (submitId.endsWith('-create')) return submitId.replace(/-create$/, '-prepare-create')
  if (submitId.endsWith('-update')) return submitId.replace(/-update$/, '-prepare-update')
  if (submitId.endsWith('-delete')) return submitId.replace(/-delete$/, '-prepare-delete')
  if (submitId.endsWith('-publish')) return submitId.replace(/-publish$/, '-prepare-publish')
  throw new Error(`study-lesson 写能力没有对应 prepare：${submitId}`)
}

function submitIdFor (prepareId: string): string {
  if (prepareId.endsWith('-prepare-attendance')) return prepareId.replace('-prepare-attendance', '-attendance-save')
  return prepareId.replace('-prepare-', '-')
}

function cancelIdFor (prepareId: string): string {
  return prepareId.replace('-prepare-', '-cancel-')
}

function endpointOf (id: string): string {
  if (id.includes('-prepare-') || id.includes('-cancel-')) return '无 HTTP 请求；prepare/cancel 只在本地校验或丢弃草稿。'
  if (id === 'study-lesson-weekly-export') return 'POST /study/lesson/studylesson/exportWeekLesson，body 为 { lessonIdList, lessonKind }，响应为二进制周课堂文件。'
  if (id.endsWith('-detail')) {
    return id.includes('-monthly-') ? 'GET /study/lesson/studylesson/getMonthLessonInfo?lessonId=...' : 'GET /study/lesson/studylesson/{id}'
  }
  if (id.endsWith('-info')) return 'GET /study/lesson/studylesson/getMonthLessonInfo?lessonId=...'
  if (id.endsWith('-student-list')) return 'GET /study/lesson/studylessonstudentrel/studyStudentList，query 含 lessonId/name/staffCode/status/pageNo/pageSize。'
  if (id.endsWith('-attendance')) return 'GET /study/lesson/lessonrecord/selectAttendanceStatus?lessonId=...'
  if (id.endsWith('-record')) return 'GET /study/lesson/lessonrecord/getLessonRecord?id=...'
  if (id.endsWith('-emcee')) return 'GET /study/lesson/studylesson/getChooseEmcee?lessonId=...'
  if (id.endsWith('-grade-info')) return 'POST /study/grade/studygrade/getGradeInfo，body 直接为 gradeIdList 数组。'
  if (id.endsWith('-last-lesson')) return 'POST /study/lesson/studylesson/getLastMonthLessonByGradeId，body 直接为 gradeIdList 数组。'
  if (id.endsWith('-student-attendance-toggle')) return 'GET /study/lesson/studylessonstudentrel/updateAttendanceStatus?id=...；这是页面的状态切换请求，不能按只读查询解释。'
  if (id.includes('-student-move-out')) return 'PUT /study/lesson/studylessonstudentrel/moveOut，body 为 { lessonId, staffCodeList, type }。'
  if (id.includes('-student-batch-delete')) return 'DELETE /study/lesson/studylessonstudentrel/moveOut，body 直接为学生行 ID 数组，无 query。'
  if (id.endsWith('-attendance-save')) return 'POST /study/lesson/lessonrecord/studentManage，body 为出勤 DTO 数组；每行带当前 lessonId。'
  if (id.endsWith('-delete')) return 'DELETE /study/lesson/studylesson，body 直接为课堂 ID 数组。'
  if (id.endsWith('-publish')) return id.includes('-weekly-') ? 'PUT /study/lesson/studylesson/publish 或 /study/lesson/studylesson/publishAndNoPush，body 只有 { id, status }。' : 'PUT /study/lesson/studylesson/publish，body 只有 { id, status }。'
  if (id === 'study-lesson-monthly-save') return 'POST /study/lesson/studylesson/saveMonthLesson，body 是月课堂 DTO、参会人/嘉宾和议案转换后的对象。'
  if (id === 'study-lesson-monthly-generic-save') return 'POST /study/lesson/studylesson/saveLesson，body 是旧月课堂通用表单拆分后的对象。'
  if (id === 'study-lesson-month-record-save') return 'POST /study/lesson/studylesson/monthLessonRecord，body 是会议记录表单对象。'
  if (id === 'study-lesson-monthly-record-save') return 'POST /study/lesson/lessonrecord/saveLessonRecord，body 是 legacy 月课堂记录对象。'
  if (id === 'study-lesson-daily-course-record-save' || id === 'study-lesson-weekly-record-save') return 'POST /study/lesson/lessonrecord/saveLessonRecordV1，body 是记录草稿对象。'
  if (id === 'study-lesson-daily-record-save') return 'POST /study/lesson/studylesson/saveLessonRecordV1，body 是记录草稿对象。'
  if (id.includes('-assignment-create')) return 'POST /study/lesson/studylesson，body 是 year 数字化且过滤 resourceId 后的 linkDTOS。'
  if (id.includes('-assignment-update')) return 'PUT /study/lesson/studylesson，body 是 year 数字化且过滤 resourceId 后的 linkDTOS。'
  if (id.endsWith('-save')) return 'POST /study/lesson/studylesson/saveLesson，body 是 time 拆分为 startTime/endTime 且去掉学生列表的对象。'
  return '按 study-lesson 页面实际端点发送；SDK 不扩展未被 Portal 页面调用的参数。'
}

function rowFields (): AiField[] {
  return [
    field('list[].id', 'string | number', '班课 ID；不是学习记录 ID或远端课程资源 ID。'),
    field('list[].title', 'string | null', '班课名称。', { nullable: true }),
    field('list[].gradeNames', 'string | null', '所属班级名称串；不能当班级 ID。', { nullable: true }),
    field('list[].type', 'number | null', '课堂类型行值；1=晨、2=周、3=月。', { nullable: true, values: { '1': '晨课堂', '2': '周课堂', '3': '月课堂' } }),
    field('list[].status', 'number | null', '课堂发布/状态原码；需要标签时按 lesson_status 字典解释。', { nullable: true }),
    field('list[].linkNum', 'string | null', '周课堂关联编号。', { nullable: true }),
    field('list[].teacherName', 'string | null', '讲师姓名。', { nullable: true }),
    field('list[].publishTime', 'string | null', '发布时间原值。', { nullable: true }),
    field('list[].createTime', 'string | null', '创建时间原值。', { nullable: true }),
    field('list[].startTime', 'string | null', '开课时间原值。', { nullable: true }),
    field('list[].endTime', 'string | null', '结课/截止时间原值。', { nullable: true }),
    field('list[].isRelGrade', 'number | null', '是否已关联班级；发布按钮只在等于 1 时可达。', { nullable: true, values: { '0': '未关联', '1': '已关联' } }),
    field('list[].isStart', 'number | null', '周课堂作业是否已开始；与 status 一起决定作业编辑门禁。', { nullable: true }),
  ]
}

function listOutput (): AiContract['output'] {
  return {
    shape: '{ list: object[], total: number }',
    fields: [
      field('list', 'object[]', '当前页班课记录；不是全量结果。'),
      field('total', 'number', '符合筛选条件的记录总数；不是当前页长度。'),
      ...rowFields(),
    ],
    empty: 'list=[] 且 total=0 表示当前筛选没有可见班课；不能仅凭空列表判断权限失败。',
  }
}

function detailFields (): AiField[] {
  return [
    field('$', 'object', '课堂详情或月课堂详情对象。'),
    field('id', 'string | number', '班课 ID。'),
    field('type', 'number | string | null', '课堂类型；晨/周/月分别为 1/2/3。', { nullable: true }),
    field('monthKind', 'number | string | null', '月课堂类型；1=表决、2=非表决。', { nullable: true, values: { '1': '表决', '2': '非表决' } }),
    field('lessonKind', 'number | string | null', '周课堂表单类型；会议/作业字段由 Portal 路由决定。', { nullable: true }),
    field('title', 'string | null', '课堂名称。', { nullable: true }),
    field('status', 'number | string | null', '课堂编辑/发布状态；truthy 时 Portal 保存按钮禁用。', { nullable: true }),
    field('isRelGrade', 'number | null', '是否关联班级；发布操作要求为 1。', { nullable: true }),
    field('isStart', 'number | null', '是否已开始；作业表单在 isStart=1 且 status=1 时不可编辑。', { nullable: true }),
    field('gradeIds', 'object[] | string | null', '晨/周/legacy 月课堂关联班级 ID 集合，保留服务端原形。', { nullable: true }),
    field('gradeIdList', 'object[] | string | null', '当前月课堂关联班级 ID 集合，保留服务端原形。', { nullable: true }),
    field('gradeStaffCodeList', 'object[] | string | null', '班级学员工号集合；保存时按 Portal 字段使用。', { nullable: true }),
    field('hostCode', 'string | number | null', '主持人/主持人工号字段；不是课堂 ID。', { nullable: true }),
    field('lessonType', 'string | number | null', 'Portal 表单课堂类型字段，保留原码。', { nullable: true }),
    field('startTime', 'string | null', '开始时间；月课堂详情由 time 拆分而来。', { nullable: true }),
    field('endTime', 'string | null', '结束时间；展示服务端原值。', { nullable: true }),
    field('time', 'object[] | null', 'Portal 表单时间范围；SDK prepare 会拆为 startTime/endTime。', { nullable: true }),
    field('info', 'string | null', '课堂说明。', { nullable: true }),
    field('lessonContentList', 'object[] | null', '晨课堂内容清单；记录提交时随 Portal 字段传递。', { nullable: true }),
    field('lessonPlan', 'string | null', '晨/周课堂记录计划文本。', { nullable: true }),
    field('linkDTOS', 'object[] | null', '周课堂作业资源关联；提交时仅保留 Portal 投影字段且过滤无 resourceId 项。', { nullable: true }),
    field('attendeeDTOList', 'object[] | null', '月课堂参会人 DTO 数组。', { nullable: true }),
    field('guestDTOList', 'object[] | null', '表决月课堂嘉宾 DTO 数组。', { nullable: true }),
    field('studyLessonMotionDTOList', 'object[] | null', '月课堂议案 DTO；avoidStaffCode/avoidName 在 Portal 保存时可由数组转逗号字符串。', { nullable: true }),
  ]
}

function studentListOutput (): AiContract['output'] {
  return {
    shape: '{ list: object[], total: number }',
    fields: [
      field('list', 'object[]', '当前课堂学生页；不是全部学生。'),
      field('total', 'number', '当前课堂筛选命中的学生总数。'),
      field('list[].id', 'string | number', '学生关联行 ID；学生批量 DELETE 使用该值。'),
      field('list[].lessonId', 'string | number | null', '所属班课 ID；出勤提交时以当前调用的 lessonId 覆盖。', { nullable: true }),
      field('list[].staffCode', 'string | number | null', '学员工号；PUT moveOut 的 staffCodeList 使用该字段。', { nullable: true }),
      field('list[].name', 'string | null', '学员姓名。', { nullable: true }),
      field('list[].status', 'number | string | null', '学生关联状态；行操作按 status === 1 决定 type=2 移出，否则 type=1 取消移出。', { nullable: true }),
      field('list[].attendanceStatus', 'number | null', '学生在该课堂的出勤状态原码。', { nullable: true }),
    ],
    empty: 'list=[] 且 total=0 表示当前课堂筛选没有学生；不能将空列表解释为移出成功。',
  }
}

function attendanceOutput (): AiContract['output'] {
  return {
    shape: 'object[] | object | null',
    fields: [
      field('$', 'object[] | object | null', 'Portal 出勤查询或切换接口返回的原始业务回执；SDK不把响应包装成另一种结构。', { nullable: true }),
      field('[]', 'object', '一条出勤记录（当端点返回数组时）。'),
      field('[].lessonId', 'string | number | null', '班课 ID。', { nullable: true }),
      field('[].staffCode', 'string | number | null', '学员工号。', { nullable: true }),
      field('[].attendanceStatus', 'number | string | null', '出勤状态原码；按 Portal 当前字典/页面标签解释。', { nullable: true }),
    ],
    empty: '空数组或 null 只能按接口结果交付；权限、网络或响应形状错误应抛出，不能伪造出勤状态。',
  }
}

function recordOutput (kind: LessonKind): AiContract['output'] {
  return {
    shape: 'object | null',
    fields: [
      field('$', 'object | null', '课堂记录详情或保存回执；保留 Portal/Java 返回的业务对象。', { nullable: true }),
      field('lessonId', 'string | number | null', '班课 ID。', { nullable: true }),
      field('recordList', 'object[] | null', '记录项数组；记录类型和值保持服务端原形。', { nullable: true }),
      field('recordList[].recordType', 'number | string | null', '记录类型原码；不自行改成业务标签。', { nullable: true }),
      field('recordList[].recordContent', 'string | null', '记录内容。', { nullable: true }),
      field('imgUrl', 'string | null', '图片 URL 逗号串。', { nullable: true }),
      field('pdfUrl', 'string | null', 'PDF URL 逗号串。', { nullable: true }),
      field('pdfName', 'string | null', 'PDF 文件名逗号串。', { nullable: true }),
      ...(kind === 'daily' ? [
        field('lessonContentList', 'object[] | null', '晨课堂记录的内容条目。', { nullable: true }),
        field('lessonPlan', 'string | null', '晨课堂记录计划。', { nullable: true }),
      ] : []),
    ],
    empty: 'null 表示端点没有返回业务对象；写入回执为空时必须按同一 lessonId 重新读取核实。',
  }
}

function emceeOutput (): AiContract['output'] {
  return {
    shape: 'object[]',
    fields: [
      field('[]', 'object', '当前课堂可选主持人记录。'),
      field('[].staffCode', 'string | number | null', '主持人工号；提交 hostCode 使用该字段。', { nullable: true }),
      field('[].name', 'string | null', '主持人姓名。', { nullable: true }),
      field('[].nickname', 'string | null', '兼容返回的用户昵称。', { nullable: true }),
    ],
    empty: '[] 表示当前页面上下文没有可选主持人；不能自行用用户 ID 或姓名替代 staffCode。',
  }
}

function gradeHelperOutput (id: string): AiContract['output'] {
  const isLast = id.endsWith('-last-lesson')
  return {
    shape: 'object[] | object | null',
    fields: [
      field('$', 'object[] | object | null', `${isLast ? '上一次月课堂' : '班级主持人信息'}接口的原始业务返回。`, { nullable: true }),
      field('[]', 'object', '当端点返回数组时的一条记录。'),
      field('[].id', 'string | number | null', `${isLast ? '上一次月课堂 ID' : '班级或主持人关联 ID'}；保留原始值。`, { nullable: true }),
      field('[].gradeId', 'string | number | null', '班级 ID。', { nullable: true }),
      field('[].hostCode', 'string | number | null', '班级主持人工号。', { nullable: true }),
      field('[].hostName', 'string | null', '主持人姓名。', { nullable: true }),
      ...(isLast ? [
        field('[].startTime', 'string | null', '上一次月课堂开始时间。', { nullable: true }),
        field('[].endTime', 'string | null', '上一次月课堂结束时间。', { nullable: true }),
        field('[].title', 'string | null', '上一次月课堂名称。', { nullable: true }),
      ] : []),
    ],
    empty: '空数组或 null 表示当前 gradeIdList 没有可复用信息；月课堂页面只有在上一次课堂为空时才继续读取 grade-info。',
  }
}

function fileOutput (): AiContract['output'] {
  return {
    shape: '{ fileName: string, contentType: string | null, base64: string, byteLength: number }',
    fields: [
      field('fileName', 'string', '固定为 Portal fileDownloadByStream 使用的下载名“周课堂.xlsx”；不跟随 Java 响应头中的“课堂信息.xlsx”等文件名。'),
      field('contentType', 'string | null', '响应 content-type；缺失时为 null。', { nullable: true }),
      field('base64', 'string', '非空二进制文件内容的标准 Base64。'),
      field('byteLength', 'number', '二进制文件字节数；必须大于 0。'),
    ],
    empty: '空响应、非二进制响应或 byteLength=0 均抛错；不能把 Java 未写出文件的空响应解释为导出成功。',
  }
}

function writeOutput (id: string): AiContract['output'] {
  const returnsLessonId = id === 'study-lesson-daily-save' || id === 'study-lesson-weekly-save'
  if (returnsLessonId) return {
    shape: 'string | number',
    fields: [field('$', 'string | number', '新建或保存后的课堂 ID；Portal 会把它继续传给课堂记录保存接口。')],
    empty: '未返回合法课堂 ID 时抛错；必须先回查课堂详情或列表再报告保存完成。',
  }
  return {
    shape: 'undefined',
    fields: [field('$', 'undefined', 'Portal页面不消费该写端点的业务回执；Promise正常完成只表示请求完成。')],
    empty: '请求抛错表示服务端未确认成功；正常完成仍需按对应列表、详情或学生页回查业务状态。',
  }
}

function prepareOutput (id: string): AiContract['output'] {
  const fields: AiField[] = [field('draft', 'object', '已通过 Portal 表单门禁并按实际请求体整理、尚未发送的本地草稿。')]
  if (id.includes('student-prepare-move-out')) fields.push(
    field('draft.lessonId', 'string | number', '当前课堂 ID。'),
    field('draft.staffCodeList', '(string | number)[]', '学员工号数组；来自学生列表 staffCode。'),
    field('draft.type', '1 | 2', '学生关系动作；1=取消移出/移入，2=移出。', { values: { '1': '取消移出', '2': '移出' } }),
  )
  else if (id.includes('student-prepare-batch-delete')) fields.push(field('draft.ids', '(string | number)[]', '学生关联行 ID 数组；DELETE body 原样发送，不改成 staffCodeList。'))
  else if (id.endsWith('-prepare-attendance')) fields.push(
    field('draft.lessonId', 'string | number', '当前课堂 ID。'),
    field('draft.records', 'object[]', '出勤行数组；每项提交时都会补当前 lessonId。'),
    field('draft.records[].staffCode', 'string | number | null', '学员工号；保留 Portal 行字段。', { nullable: true }),
    field('draft.records[].attendanceStatus', 'number | string | null', '出勤状态原码。', { nullable: true }),
    field('draft.records[].lessonId', 'string | number', '被 SDK 固定覆盖为 draft.lessonId。'),
  )
  else if (id.includes('prepare-delete')) fields.push(
    field('draft.ids', '(string | number)[]', '课堂 ID 数组；DELETE body 直接发送。'),
  )
  else if (id.includes('prepare-publish')) fields.push(
    field('draft.id', 'string | number', '当前课堂 ID。'),
    field('draft.status', '0 | 1', '发布 body 状态；1=发布，0=取消发布。', { values: { '0': '未发布/取消发布', '1': '已发布' } }),
    field('draft.publishAndNoPush', 'boolean | undefined', '仅周课堂允许；true 只改变 URL 为 publishAndNoPush，body 仍只有 id/status。', { optional: true }),
  )
  else if (id.endsWith('month-record-prepare-save')) fields.push(
    field('draft.id', 'string | number', '月课堂会议记录关联 ID。'),
    field('draft.attendeeDTOList', 'object[] | null', '参会人 DTO 数组；必须保留详情中的当前数组。', { nullable: true }),
    field('draft.guestDTOList', 'object[] | null', '嘉宾 DTO 数组；表决类月课堂使用。', { nullable: true }),
    field('draft.studyLessonMotionDTOList', 'object[] | null', '议案数组；不能用月课堂创建草稿代替。', { nullable: true }),
    field('draft.studyLessonRecordDTO', 'object | null', '会议记录 DTO；来自当前详情/记录表单。', { nullable: true }),
  )
  else if (id.endsWith('record-prepare-save') || id.endsWith('course-record-prepare-save')) fields.push(
    field('draft.lessonId', 'string | number', '当前课堂 ID。'),
    field('draft.recordList', 'object[]', '记录项数组；records.thought/technology/management 会按 Portal 类型映射。'),
    field('draft.imgUrl', 'string', '图片 URL 逗号串；由 imgList 或 imgUrl 归一。'),
    field('draft.pdfUrl', 'string', 'PDF URL 逗号串；由 pdfList 或 pdfUrl 归一。'),
    field('draft.pdfName', 'string', 'PDF 文件名逗号串。'),
  )
  else if (id.includes('prepare-save') || id.includes('prepare-create') || id.includes('prepare-update')) {
    fields.push(
      field('draft.type', '1 | 2 | 3', '课堂类型；晨/周/月由页面能力固定，调用方不可跨页切换。'),
      field('draft.lessonKind', 'number | string | null', '周课堂会议/作业类型；按 Portal 目标表单保留。', { nullable: true }),
      field('draft.title', 'string | null', '课堂名称。', { nullable: true }),
      field('draft.gradeIds', 'object[] | string | null', '晨/周/legacy 月课堂班级字段；保留页面字段形状。', { nullable: true }),
      field('draft.gradeIdList', 'object[] | string | null', '当前月课堂班级字段；保留页面字段形状。', { nullable: true }),
      field('draft.gradeStaffCodeList', 'object[] | string | null', '班级学员工号集合。', { nullable: true }),
      field('draft.hostCode', 'string | number | null', '主持人工号。', { nullable: true }),
      field('draft.lessonType', 'string | number | null', '课堂类型字段原码。', { nullable: true }),
      field('draft.startTime', 'string | null', '由 form.time[0] 拆出的开始时间。', { nullable: true }),
      field('draft.endTime', 'string | null', '由 form.time[1] 拆出的结束时间。', { nullable: true }),
      field('draft.info', 'string | null', '课堂说明。', { nullable: true }),
      field('draft.status', 'number | string | null', '当前状态；truthy 状态在 prepare 阶段拒绝编辑。', { nullable: true }),
    )
    if (id.includes('monthly-prepare-save')) fields.push(
      field('draft.monthKind', '1 | 2 | null', '1=表决，2=非表决；由 voting/nonvoting 路由固定。', { nullable: true }),
      field('draft.attendeeDTOList', 'object[] | null', '从 attendanceData 或 Portal 表单参会数组得到。', { nullable: true }),
      field('draft.guestDTOList', 'object[] | null', '从 guestData 或 Portal 表单嘉宾数组得到。', { nullable: true }),
      field('draft.studyLessonMotionDTOList', 'object[] | null', '议案；avoidStaffCode/avoidName 数组会转逗号字符串。', { nullable: true }),
    )
    if (id.includes('assignment-')) fields.push(
      field('draft.year', 'number', 'Portal assignment 表单 year 强制转数字。'),
      field('draft.linkDTOS', 'object[]', '只保留有 resourceId 的资源关联。'),
      field('draft.linkDTOS[].id', 'string | number | null', '编辑时资源关联 ID。', { nullable: true }),
      field('draft.linkDTOS[].title', 'string | null', '资源标题。', { nullable: true }),
      field('draft.linkDTOS[].type', 'string | number | null', '资源类型原码。', { nullable: true }),
      field('draft.linkDTOS[].endTime', 'string | null', '资源截止时间。', { nullable: true }),
      field('draft.linkDTOS[].resourceId', 'string | number', '远端资源 ID；无该值的项被 Portal 过滤。'),
      field('draft.linkDTOS[].sort', 'number | null', '资源排序。', { nullable: true }),
      field('draft.linkDTOS[].rater', 'string', '评分人字段；缺省归一为空串。'),
    )
  }
  return { shape: '{ draft: object }', fields, empty: '校验失败时抛错且不发请求；成功只表示本地草稿已准备好。' }
}

function cancelOutput (): AiContract['output'] {
  return {
    shape: '{ cancelled: true }',
    fields: [field('cancelled', 'boolean', '固定为 true；仅表示本地草稿已丢弃，没有后端回滚。')],
    empty: 'cancel 不发 HTTP 请求；已提交的后端课堂、学生、出勤或记录不能由该能力撤回。',
  }
}

function readOutput (id: string): AiContract['output'] {
  if (id === 'study-lesson-weekly-export') return fileOutput()
  if (id.endsWith('-student-list')) return studentListOutput()
  if (id.endsWith('-attendance')) return attendanceOutput()
  if (id === 'study-lesson-daily-record' || id === 'study-lesson-weekly-record') return recordOutput(lessonKindOf(id))
  if (id.endsWith('-emcee')) return emceeOutput()
  if (id.endsWith('-grade-info') || id.endsWith('-last-lesson')) return gradeHelperOutput(id)
  if (id.endsWith('-detail') || id.endsWith('-info')) return { shape: 'object | null', fields: detailFields(), empty: 'null 表示当前 ID 没有可返回详情；响应形状或权限错误不能伪造成空详情。' }
  return { shape: 'object | null', fields: [field('$', 'object | null', 'Portal 读取接口的业务对象；保留未列出的兼容字段。', { nullable: true })], empty: '空业务对象按端点语义交付；权限、网络或响应形状错误应抛出。' }
}

function extraInputsFor (id: string): Record<string, AiParameter> {
  const overrides: Record<string, AiParameter> = {}
  const prepare = id.includes('-prepare-')
  if (id.endsWith('-detail') || id.endsWith('-record') || id.endsWith('-info')) {
    overrides.id = param('当前课堂 ID；必须来自对应课堂列表。', `${pageMeta[lessonKindOf(id)].label}列表返回的 list[].id`, { type: 'string | number', required: true })
    if (id.endsWith('-info')) {
      overrides.lessonId = param('当前月课堂 ID；页面以 query.lessonId 发送。', 'study-lesson-monthly-list.list[].id 或用户明确选择', { type: 'string | number', required: true })
      delete overrides.id
    }
  }
  if (id.endsWith('-student-list') || id.endsWith('-attendance') || id.endsWith('-emcee')) {
    overrides.lessonId = param('当前课堂 ID；必须来自对应课堂列表或详情。', `${pageMeta[lessonKindOf(id)].label}列表返回的 list[].id`, { type: 'string | number', required: true })
  }
  if (id.endsWith('-student-attendance-toggle')) overrides.id = param('学生关联行 ID；来自隐藏学生页 list[].id，不是学员工号。', `${pageMeta[lessonKindOf(id)].label}学生页返回的 list[].id`, { type: 'string | number', required: true })
  if (id.endsWith('-grade-info') || id.endsWith('-last-lesson')) overrides.gradeIdList = param('班级 ID 数组；页面 POST body 直接发送该数组，不包装为对象。', '当前月课堂表单的 gradeIdList 或班级候选', { type: '(string | number)[]', required: true })
  if (id === 'study-lesson-weekly-export') {
    overrides.lessonIdList = param('列表当前勾选的周课堂 ID 数组；至少一项且不能重复。', 'study-lesson-weekly-list.list[].id 中用户勾选的行', { type: '(string | number)[]', required: true, constraints: ['至少一项', '不能包含重复课堂 ID'] })
    overrides.lessonKind = param('导出模式；必须与所选周课堂页面类型一致。0=会议周课堂，1=作业周课堂。', '周课堂列表按钮 actionTypeExport 的 mode', { type: '0 | 1', required: true, options: [{ value: 0, label: '会议周课堂' }, { value: 1, label: '作业周课堂' }] })
  }
  if (id.includes('-prepare-') && !id.includes('student-prepare')) {
    overrides.form = param('Portal 隐藏表单完整字段；必须保留页面字段并按当前课堂类型填写。', 'Portal 对应隐藏表单或最新详情；用户确认的修改只覆盖明确字段', { type: 'object', required: true })
    overrides.status = param('编辑时当前表单 status；Portal 保存按钮按 !!status 禁用，truthy 值在 prepare 阶段拒绝。', 'Portal 表单/详情 status', { type: 'string | number | boolean | null', required: false, nullable: true })
  }
  if (id.includes('-student-prepare-move-out')) {
    overrides.lessonId = param('当前课堂 ID。', `${pageMeta[lessonKindOf(id)].label}列表/详情`, { type: 'string | number', required: true })
    overrides.staffCodeList = param('待操作学员工号数组；行操作通常只有一项。', `${pageMeta[lessonKindOf(id)].label}学生页 list[].staffCode`, { type: '(string | number)[]', required: true })
    overrides.currentStatus = param('学生当前关联状态；Portal 用 status === 1 生成 type=2，否则生成 type=1。', `${pageMeta[lessonKindOf(id)].label}学生页 list[].status`, { type: 'number | string', required: true, constraints: ['必须来自最新学生行，不能按用户猜测状态。'] })
  }
  if (id.includes('-student-prepare-batch-delete')) overrides.ids = param('学生关联行 ID 数组；按 Portal 批量按钮原样作为 DELETE body 发送。', `${pageMeta[lessonKindOf(id)].label}学生页选中行 list[].id`, { type: '(string | number)[]', required: true })
  if (id.endsWith('-prepare-attendance')) {
    overrides.lessonId = param('当前课堂 ID；保存时覆盖每个 records[].lessonId。', `${pageMeta[lessonKindOf(id)].label}列表/详情`, { type: 'string | number', required: true })
    overrides.records = param('Portal 出勤 DTO 行数组；保留页面原字段，SDK 只补/覆盖 lessonId。', `${pageMeta[lessonKindOf(id)].label}课堂记录弹窗当前行数据`, { type: 'object[]', required: true })
  }
  if (id.includes('-prepare-delete')) {
    overrides.ids = param('课堂 ID 数组；单删也按数组发送。', `${pageMeta[lessonKindOf(id)].label}列表选中行 list[].id`, { type: '(string | number)[]', required: true })
    overrides.statuses = param('已知列表行 status 数组；含 status=1 时 prepare 拒绝，因为 Portal/Java 不允许删除已发布课堂。', `${pageMeta[lessonKindOf(id)].label}列表行 status`, { type: '(string | number)[]', required: false })
  }
  if (id.includes('-prepare-publish')) {
    overrides.id = param('课堂 ID。', `${pageMeta[lessonKindOf(id)].label}列表行 list[].id`, { type: 'string | number', required: true })
    overrides.currentStatus = param('列表行当前 status；晨/月课堂按 0/非 0 取反，周课堂按 action 严格门禁。', `${pageMeta[lessonKindOf(id)].label}列表行 status`, { type: 'number', required: true, constraints: ['只能是 0 或 1。'] })
    overrides.isRelGrade = param('列表行是否已关联班级；必须为 1 才允许 Portal 显示发布按钮。', `${pageMeta[lessonKindOf(id)].label}列表行 isRelGrade`, { type: 'number', required: true, constraints: ['必须等于 1。'] })
    if (id.includes('-weekly-')) overrides.action = param('周课堂发布动作；publish、publishAndNoPush 或 cancel。publishAndNoPush 只切换 URL，不进入 body。', '用户明确选择及周课堂列表按钮', { type: 'string', required: true, options: [{ value: 'publish', label: '发布' }, { value: 'publishAndNoPush', label: '发布但不推送' }, { value: 'cancel', label: '取消发布' }] })
  }
  if (!id.includes('-prepare-') && !id.includes('-cancel-') && (id.endsWith('-save') || id.endsWith('-create') || id.endsWith('-update'))) {
    const prepareId = draftPrepareId(id)
    overrides.draft = param('对应 prepare 能力返回的完整 Portal 草稿；不要把原始 form 或页面未提交字段拼回去。', `${prepareId}.result.draft`, { type: 'object', required: true })
  }
  if (!id.includes('-prepare-') && !id.includes('-cancel-') && (id.endsWith('-move-out') || id.endsWith('-batch-delete') || id.endsWith('-delete') || id.endsWith('-publish'))) {
    const prepareId = draftPrepareId(id)
    overrides.draft = param('对应 prepare 能力返回的完整草稿；只提交同一份草稿。', `${prepareId}.result.draft`, { type: 'object', required: true })
  }
  return overrides
}

function recoveryTargetFor (id: string): string | null {
  const kind = lessonKindOf(id)
  if (id.includes('-student-move-out') || id.includes('-student-batch-delete') || id.endsWith('-student-attendance-toggle')) return `study-lesson-${kind}-student-list`
  if (id.endsWith('-attendance-save')) return `study-lesson-${kind}-attendance`
  if (id === 'study-lesson-daily-record-save' || id === 'study-lesson-daily-course-record-save') return 'study-lesson-daily-record'
  if (id === 'study-lesson-weekly-record-save') return 'study-lesson-weekly-record'
  if (id === 'study-lesson-monthly-record-save' || id === 'study-lesson-month-record-save') return 'study-lesson-monthly-info'
  if (id.endsWith('-delete') || id.endsWith('-publish') || id.endsWith('-save') || id.includes('-assignment-create') || id.includes('-assignment-update')) return `study-lesson-${kind}-list`
  return null
}

function recoveryStep (id: string): AiContract['steps'][number] | null {
  const target = recoveryTargetFor(id)
  if (!target) return null
  const mapping: Record<string, string> = {}
  if (target.endsWith('-student-list')) mapping.lessonId = 'context.lessonId'
  else if (target.endsWith('-attendance')) mapping.lessonId = 'context.lessonId'
  else if (target.endsWith('-record')) mapping.id = 'context.lessonId'
  return {
    role: 'recovery',
    when: '请求成功、超时或响应丢失后需要确认最终业务状态',
    capabilityId: target,
    mapping,
    instruction: '按同一课堂/学生/记录上下文重新读取并逐字段核对；没有独立回查证据时只报告请求结果，不把空回执当作已完成。',
  }
}

function stepsFor (id: string, effect: AiContract['effect']): AiContract['steps'] {
  if (effect === 'prepare') {
    const submitId = submitIdFor(id)
    const cancelId = cancelIdFor(id)
    return [
      { role: 'required', when: '用户明确确认提交', capabilityId: submitId, mapping: { draft: 'result.draft' }, instruction: '把同一份 prepare.result.draft 交给对应 submit；不要改写、补回或删除 Portal 未提交字段。' },
      { role: 'cancel', when: '用户取消表单或动作', capabilityId: cancelId, instruction: '只丢弃本地草稿，不发送 Portal 写请求；已提交副作用不由 cancel 撤回。' },
    ]
  }
  if (effect === 'write') {
    const recovery = recoveryStep(id)
    return recovery ? [recovery] : []
  }
  if (id === 'study-lesson-monthly-last-lesson') {
    return [{ role: 'optional', when: '按班级查询不到可复用的上一次月课堂', capabilityId: 'study-lesson-monthly-grade-info', mapping: { gradeIdList: 'args.gradeIdList' }, instruction: '保持 Portal handleGradeChange 顺序：只有 last-lesson 为空时才读取班级主持人信息。' }]
  }
  return []
}

function actionContract (id: string): AiContract {
  const definition = actionDefinitions.get(id)
  if (!definition) throw new Error(`study-lesson 动作没有定义：${id}`)
  const kind = lessonKindOf(id)
  const meta = pageMeta[kind]
  const isPrepare = id.includes('-prepare-')
  const isCancel = id.includes('-cancel-')
  const effect: AiContract['effect'] = isPrepare ? 'prepare' : isCancel ? 'local' : definition.write ? 'write' : 'read'
  const output = isPrepare ? prepareOutput(id) : isCancel ? cancelOutput() : effect === 'write' ? writeOutput(id) : readOutput(id)
  const inputs = inputsFor(id, extraInputsFor(id))
  const boundaries = [...commonBoundaries, `本能力属于${meta.label}（${meta.pagePath}），页面权限为 ${meta.permission}；不能拿另一页的 type、表单或请求实例替代。`]
  if (id.includes('prepare-save') || id.includes('prepare-create') || id.includes('prepare-update')) boundaries.push('表单保存门禁按 Portal 原样执行：status truthy 时不可编辑；周课堂作业另有 isStart=1 且 status=1 的不可编辑门禁，不能只检查一个字段。')
  if (id.includes('prepare-publish') || id.endsWith('-publish')) boundaries.push('发布门禁按 Portal 原样执行：列表行 isRelGrade 必须等于 1；周课堂 action 还区分 publish、publishAndNoPush、cancel，publishAndNoPush 仅改变 URL，body 仍只有 id/status。')
  if (id.includes('student-batch-delete')) boundaries.push('学生页批量动作严格保留 Portal 的 DELETE /moveOut + 裸 ID 数组形状；Java 的 PUT MoveOutLessonStudentDTO 与该 DELETE 形状不是同一契约，不能擅自转换。')
  if (id.includes('monthly-generic') || id.includes('monthly-record')) boundaries.push('legacy 月课堂能力只对应旧 monthly-lesson/[mode]/[id].vue 的 saveLesson/saveLessonRecord；不能与当前 voting/nonvoting 的 saveMonthLesson/monthLessonRecord 混用。')
  if (id.includes('monthly-prepare-save') || id.includes('month-record')) boundaries.push('当前月课堂按 Portal 路由固定保留 monthKind、gradeIdList、参会人/嘉宾/议案；avoidStaffCode/avoidName 只有在提交草稿时才转成逗号字符串。')
  if (id === 'study-lesson-weekly-export') boundaries.push('导出按钮按 Portal 原样发送选中的 lessonIdList 和 lessonKind：0=会议周课堂，1=作业周课堂；返回必须是非空文件，不能把空响应当作成功。')

  const consume = [endpointOf(id)]
  if (effect === 'prepare') consume.push('在用户确认前展示 result.draft 的实际字段；取消只丢弃它。')
  else if (effect === 'local') consume.push('result.cancelled=true 只表示本地取消，没有远端回滚。')
  else if (effect === 'write') consume.push('写请求结束或结果不确定时按同一 ID/课堂/学生上下文回查；重试前先核实，不能只凭 HTTP 成功或空回执报告完成。')
  else consume.push('按 Portal 返回字段交付；空结果与权限/网络错误分别处理，不以空结果替代异常。')

  const gaps = effect === 'write' || effect === 'prepare' || effect === 'local' ? writeEvidenceGaps : hiddenReadEvidenceGaps
  return {
    purpose: `${definition.title}；复刻${meta.label}页面可达动作与其 Portal/Java 请求规则。`,
    whenToUse: `当前用户在${meta.label}页面权限范围内，需要执行“${definition.title}”时使用；先确认目标记录属于当前租户和页面上下文。`,
    boundaries,
    effect,
    prerequisites: [
      `使用当前用户会话、租户和${meta.label}页面上下文；SDK 根据 pagePath 推导 module-type=12，调用方不要自行拼接权限头。`,
      '课堂 ID、班级 ID、学员工号、学生关联行 ID 和当前 status 必须来自同一页面的最新读取结果或用户明确输入；不能拿名称猜 ID。',
    ],
    inputs,
    output,
    consume,
    steps: stepsFor(id, effect),
    completion: effect === 'prepare'
      ? '得到已通过 Portal 门禁、尚未发请求的草稿；只有用户确认并执行对应 submit 后才进入写入阶段。'
      : effect === 'local'
        ? '返回 cancelled=true 且没有 HTTP 请求；已提交的业务副作用保持原状态。'
        : effect === 'write'
          ? '请求未抛错且回查确认目标业务状态与草稿一致后，才能报告写入完成。'
          : '返回与对应 Portal 端点一致的课堂/学生/记录/辅助数据，并按字段语义交付。',
    failures: [
      'Portal 表单字段、ID、status、isRelGrade、isStart 或课堂类型不满足页面门禁时在本地抛错；不要通过删除门禁字段绕过页面规则。',
      '权限、租户数据范围、Java 业务校验、网络错误或响应形状变化按原错误处理；不能把空数组、空对象或空回执解释成成功。',
      ...(id === 'study-lesson-weekly-export' ? ['当前 Java exportWeekLesson 对 lessonKind=1 会调用作业导出服务但控制器不写文件响应；SDK 对空响应抛错，这是后端实现缺口，不应绕过。'] : []),
      ...(id.includes('student-batch-delete') ? ['Java 固定检出明确提供 PUT moveOut DTO，但 Portal 学生页批量按钮仍发送 DELETE /moveOut 裸数组；该兼容差异需真实环境验证，失败时报告端点不兼容。'] : []),
    ],
    idempotency: effect === 'write'
      ? 'Portal 这些端点没有统一持久 requestId 幂等契约；响应超时或丢失时先用步骤中的读取能力核实，再决定是否复用同一业务草稿重试。'
      : null,
    evidence,
    gaps,
  }
}

const actionContracts = Object.fromEntries(
  studyLessonActionCapabilities.map(definition => [definition.id, actionContract(definition.id)]),
) as Record<string, AiContract>

function listContract (id: string): AiContract {
  const kind = lessonKindOf(id)
  const meta = pageMeta[kind]
  return {
    purpose: `查询${meta.label}班课列表；课堂类型由能力固定为 ${kind === 'daily' ? '1' : kind === 'weekly' ? '2' : '3'}，不能通过参数切换。`,
    whenToUse: `需要按${meta.label}页面筛选条件读取班课时使用。`,
    boundaries: [
      ...commonBoundaries,
      `列表请求使用 ${meta.pagePath} 页面上下文和 GET /study/lesson/studylesson/lessonList；${kind === 'daily' ? '晨课堂日期两端是 YYYY-MM-DD 00:00:00' : '周/月课堂日期格式是 YYYY-MM-DD HH:mm:ss'}，结束日均为 +1 天开区间。`,
    ],
    effect: 'read',
    prerequisites: [`使用当前用户会话、租户和${meta.label}页面权限；结果只代表当前数据范围。`],
    inputs: inputsFor(id),
    output: listOutput(),
    consume: ['按 list[].id 定位后续详情、发布、删除或学生/记录动作；按 total 翻页，不把当前页当全集。', 'status 需要标签时调用 base-dict-get(dictType="lesson_status")，不要猜状态码。'],
    steps: [],
    completion: `返回当前筛选条件的一页${meta.label}列表及 total；查询不产生写入。`,
    failures: ['权限、租户、网络或响应形状错误应抛出；list=[] 只表示当前筛选无结果。'],
    idempotency: null,
    evidence,
  }
}

// Existing list capability contracts stay authoritative in contracts-business.ts. This local map
// only supplies method-path adapters for those three pre-existing methods, avoiding a second
// capability entry with different list semantics.
const existingListContracts: Record<string, AiContract> = Object.fromEntries(
  ['study-lesson-daily-list', 'study-lesson-weekly-list', 'study-lesson-monthly-list'].map(id => [id, listContract(id)]),
)

/** New action capability contracts; the three old list IDs remain owned by contracts-business.ts. */
export const STUDY_LESSON_AI_CONTRACTS: Record<string, AiContract> = actionContracts

/** Every STUDY_LESSON_METHODS entry has a public method-path contract. */
export const STUDY_LESSON_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(STUDY_LESSON_METHODS).map(([capabilityId, method]) => {
    const source = actionContracts[capabilityId] ?? existingListContracts[capabilityId]
    if (!source) throw new Error(`STUDY_LESSON_METHODS 没有对应契约：${capabilityId}`)
    return [`studyLesson.${method}`, {
      ...source,
      boundaries: [...source.boundaries, `这是公开方法 sdk.studyLesson.${method}；参数按本契约 inputs 传入，写操作仍必须遵守 prepare → submit → cancel。`],
    }]
  }),
)

/* ---------------------------------------------------------------------------
 * 学习记录页与月课堂隐藏子页（本节点新增）
 *
 * 与上面两组**分开导出**：`STUDY_LESSON_AI_CONTRACTS` / `STUDY_LESSON_METHOD_CONTRACTS`
 * 已经被 `contracts-business.ts` 合并进权威目录，本组还没有，接线由派单方统一做。
 * 分开的理由见 `src/capabilities/study-lesson.ts` 里 `studyLessonHiddenCapabilities` 的注释。
 * ------------------------------------------------------------------------- */

const hiddenDefinitions = new Map(studyLessonHiddenCapabilities.map(definition => [definition.id, definition]))

const hiddenEvidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:6ac274fc9e app/portal/views/dashboard/education/lesson/{daily-lesson,weekly-lesson,monthly-lesson}/record/[id]/item-list.vue、monthly-lesson/meeting-resolution/[mode]/[id]/{item-list.vue,components/view-meeting.vue}、monthly-lesson/score-record/[id]/{item-list.vue,components/score-record.vue}',
    kind: 'reference',
    note: '逐页核对隐藏子路由与弹窗实际发出的 URL、HTTP 方法、参数键序、列表模块的 getDataListIsPage/deleteIsBatch 取值、以及弹窗内本地过滤与本地排序；三份 record/[id]/item-list.vue 已逐字比对（晨/周/月三页的列表与删除配置完全相同）。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:77fbc2a206c StudyStudyRecordController、StudyLessonController（getMotionByLesson/getMotionRateListByLesson/getRateListByMotionId）、OverseeTaskController、StudyStudyRecordServiceImpl、StudyLessonMotionServiceImpl、LessonStudyStudentDTO、StudyLessonMotionDTO、StudyMonthMotionLessonRateDTO、OverseeTaskRespVO',
    kind: 'reference',
    note: '核对 HTTP 路由、DTO 字段、service 的读写行为（是否 insert/update）、删除的 -1 业务返回与错误文案、getRateListByMotionId 的排序白名单与内存过滤；固定检出的静态证据不代表已部署版本。',
  },
  {
    source: 'src/capabilities/study-lesson.ts',
    kind: 'implementation',
    note: '核对 STUDY_LESSON_HIDDEN_METHODS、studyLessonHiddenCapabilities、参数装配顺序、本地名称过滤、DELETE 数组 body 与 id 校验。',
  },
  {
    source: 'test/study-lesson.test.ts',
    kind: 'test',
    note: '锁定 URL/method/params 键序、DELETE body 形状、name 不进 query、以及 -1 业务失败的契约文字；离线断言不替代真实测试环境读取。',
  },
]

const hiddenGaps = [
  '本轮未在真实测试环境读取这些隐藏子页/弹窗：请求形状来自固定 Portal/Java 检出与离线测试，字段可空性与真实返回条数未实测。',
  '学习记录列表与议案的返回结构没有浏览器基准（这几页在上一轮基准抓取范围之外），字段语义来自后端 DTO 与页面 columns。',
  '晨课堂与月课堂的 record/[id]/item-list 在固定检出里**没有入口**（两个列表页打开的都是弹窗，全仓没有 push 到这两条子路由的代码）；对应能力是否应当按 conventions §28 移除尚未决定，见 study-lesson-{daily,monthly}-record-list 的边界。',
]

function hiddenParam (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter {
  return { meaning, source, ...extra }
}

const RECORD_ROW_FIELDS: AiField[] = [
  field('list[].id', 'string | number', '学习记录 ID；移出（study-record-remove）用的就是它，不是学员工号。'),
  field('list[].name', 'string | null', '学员姓名。', { nullable: true, nullMeaning: '学员档案里没有姓名或后端未返回' }),
  field('list[].staffCode', 'string | number | null', '学员工号。', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].mobile', 'string | null', '联系方式。', { nullable: true, nullMeaning: '学员档案没有手机号' }),
  field('list[].orgName', 'string | null', '标准化单元（组织名称）；学员没有组织时为 null。', { nullable: true, nullMeaning: '学员没有挂组织' }),
  field('list[].isRelatedLayer', 'number | null', '是否关联智慧蛋鸡；页面按 yes_or_no 字典显示。', { nullable: true, values: { '0': '未关联', '1': '已关联' }, nullMeaning: '后端未返回' }),
  field('list[].createTime', 'string | null', '入班时间。', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].isAdmAdd', 'number | null', '这条学习记录是否管理员手动添加：**只有 1 的行才会渲染"移出"按钮**，0 的行移出会被后端拒绝。', { nullable: true, values: { '0': '学员自学产生', '1': '管理员添加' }, nullMeaning: '后端未返回' }),
]

function recordListOutput (label: string): AiContract['output'] {
  return {
    shape: '{ list: object[], total: number }',
    fields: [
      field('list', 'object[]', `当前页${label}学习记录；不是全班学员名单。`),
      field('total', 'number', '符合当前筛选的记录总数，不是当前页长度。'),
      ...RECORD_ROW_FIELDS,
    ],
    empty: 'list=[] 且 total=0 表示这个课堂当前没有可见的学习记录；不能把空列表当成"已移出成功"。',
  }
}

const RECORD_LIST_INPUTS: Record<string, AiParameter> = {
  lessonId: hiddenParam('当前课堂 ID；不是学习记录 ID、也不是班课环节 ID。', '对应课堂的 list[].id（隐藏路由 record/[id] 的 id）', { type: 'string | number', required: true }),
  name: hiddenParam('学员姓名，后端 LIKE 模糊匹配。', '用户输入的学员姓名', { type: 'string', required: false }),
  staffCode: hiddenParam('学员工号，后端等值匹配；不是用户 ID。', '用户输入的工号', { type: 'string | number', required: false }),
  pageNo: hiddenParam('从 1 开始的页码。', '调用方分页状态', { type: 'integer', required: false, default: '1', constraints: ['正整数'] }),
  pageSize: hiddenParam('每页条数；Portal 列表模块默认 20。', '调用方分页状态', { type: 'integer', required: false, default: '20', constraints: ['正整数'] }),
}

/**
 * 「这个 record 子页现在到底进不进得去」——三页不一样，而派单表把它们当同一件事。
 *
 * 实测（固定检出 `6ac274fc9e`，全仓 `grep -rn 'record/.*item-list'` 只命中 4 处）：
 * - **周课堂可达**：`weekly-lesson/list.vue:77` 的「学习记录」按钮
 *   （`v-if="record.lessonKind === 1"`，即作业周课堂行）`router.push('./record/${id}/item-list')`。
 * - **晨课堂不可达**：daily 列表的「课堂记录」打开的是弹窗（`components/course-record.vue`），
 *   没有 push 到 `daily-lesson/record/[id]/item-list` 的代码。
 * - **月课堂不可达**：monthly 列表的「会议记录」也是弹窗（会议记录弹窗），
 *   该页只 push `meeting-resolution/...` 与 `score-record/...`。
 *
 * 按 conventions §28「能渲染不等于用户能做的事」的口径，晨/月两份本可以不算能力；
 * 但派单表把三条都列进来了，所以这里**保留三条**并把事实写进说明，由派单方决定是否裁掉。
 */
const RECORD_PAGE_REACHABILITY: Record<LessonKind, string> = {
  daily: '⚠️ **本页当前没有可达入口**：晨课堂列表的「课堂记录」打开的是弹窗（`components/course-record.vue`），固定检出里没有任何代码 push 到 `daily-lesson/record/[id]/item-list`。能力按派单表保留，但按 conventions §28「能渲染不等于用户能做的事」它可能应当移除 —— 这一点未决。',
  weekly: '本页可达：周课堂列表的「学习记录」按钮（`weekly-lesson/list.vue:77`，`v-if="record.lessonKind === 1"`，即作业周课堂行）push 到 `./record/${id}/item-list`。',
  monthly: '⚠️ **本页当前没有可达入口**：月课堂列表的「会议记录」打开的是弹窗，固定检出里只 push `meeting-resolution/...` 与 `score-record/...`，没有 push 到 `monthly-lesson/record/[id]/item-list`。能力按派单表保留，但按 conventions §28 它可能应当移除 —— 这一点未决。',
}

function recordListContract (id: string): AiContract {
  const kind = lessonKindOf(id)
  const meta = pageMeta[kind]
  return {
    purpose: `查询「${meta.label}」某个课堂下的学习记录（学员名单）分页；返回的是学员行，不是课程资源。`,
    whenToUse: `从${meta.label}列表进入该课堂的「学习记录」子页、需要看这个课堂里有哪些学员（以及谁是可移出的）时使用。`,
    boundaries: [
      ...commonBoundaries,
      `**本能力只服务${meta.label}的隐藏子页 ${meta.pagePath} 下的 record/[id]/item-list.vue**；晨/周/月三页各自有独立能力，请求与后端方法相同但页面上下文不同，不要拿本能力代替另外两页。`,
      RECORD_PAGE_REACHABILITY[kind],
      '列表行 ID 是 hr_study_record 的记录 ID；staffCode 是学员工号，移出时两者不能互换。',
      '本能力只读，不改变学员与课堂的关系；移出要走 study-record-remove。',
    ],
    effect: 'read',
    prerequisites: [
      `使用当前用户会话、租户和${meta.label}页面权限（${meta.permission}）；结果只代表当前数据范围。`,
      'lessonId 必须来自课堂列表返回的 list[].id，不能用课堂名称或班课环节 ID 代替。',
    ],
    inputs: RECORD_LIST_INPUTS,
    output: recordListOutput(meta.label),
    consume: [
      '按 list[].id 作为移出目标；按 list[].isAdmAdd 判断这一行能不能移出（只有 1 能），不要用 status 或 whether 之类的字段替代。',
      'isRelatedLayer 需要中文标签时按 yes_or_no 字典解释；isAdmAdd 是页面自己的可见性判据，不在字典里。',
    ],
    steps: [
      { role: 'optional', when: '用户要移出选中的行', capabilityId: 'study-record-remove', mapping: { ids: 'result.list[].id' }, instruction: '只把 isAdmAdd=1 的行的 id 放进数组；0 的行会被后端整体拒绝（连同一批里能移出的也一起失败）。' },
    ],
    completion: `返回该课堂当前筛选下的一页${meta.label}学习记录及 total；读取本身不改变任何学员关系。`,
    failures: [
      '权限、租户数据范围、网络或响应形状错误原样抛出；list=[] 只表示当前筛选没有记录。',
      `lessonId 缺失或不是正整数时在发请求前抛错（页面上下文由隐藏路由提供，调用方不要猜）。`,
    ],
    idempotency: null,
    evidence: hiddenEvidence,
    gaps: hiddenGaps,
  }
}

const RECORD_REMOVE_INPUTS: Record<string, AiParameter> = {
  ids: hiddenParam(
    '待移出的学习记录 ID 数组；单删也发只有一个元素的数组。',
    'study-lesson-weekly-record-list 返回的 list[].id',
    { type: '(string | number)[]', required: true, constraints: ['非空', '每项为安全正整数或无前导零的正整数字符串', '只放 isAdmAdd=1 的行'] },
  ),
}

const hiddenContracts: Record<string, AiContract> = {
  'study-lesson-weekly-record-list': recordListContract('study-lesson-weekly-record-list'),

  'study-record-remove': {
    purpose: '把学员从课堂的学习记录里移出（页面按钮文案就是"移出"）；请求是 DELETE，body 是一个 ID 数组。',
    whenToUse: '用户在某个课堂的「学习记录」子页选中一行或多行（isAdmAdd=1）并确认移出时使用；这是真写，不是只读查询。',
    boundaries: [
      ...commonBoundaries,
      '**同一个请求在晨/周/月三个 record/[id] 子页上逐字节相同**（三份 item-list.vue 的 deleteURL 与 deleteIsBatch 完全相同），所以这里合成一个能力；它的页面上下文绑定在**周课堂**页 —— 三页里只有周课堂列表真的 push 到自己的 record 子页（`weekly-lesson/list.vue:77` 的「学习记录」，`v-if="record.lessonKind === 1"`），晨/月两页的同名子页在固定检出里没有入口。三页的 module-type 推导同为 12，请求本身不区分页面。',
      '⚠️ **晨/月两份 record 子页当前不可达**（理由见 `study-lesson-{daily,monthly}-record-list` 的边界）；本能力绑在可达的周课堂上，但它移除的其实是"任意一个课堂的学习记录"，与入口页无关。',
      '请求形状是 renren 列表模块的 `deleteIsBatch: true` 分支：`DELETE deleteURL` + JSON 数组 body，**没有 query、也没有 `${deleteURL}/{id}` 这种路径参数**。改成路径参数就不是这一页发的东西了。',
      '本能力只移出"管理员添加的学习记录"；它不删除学员档案，也不解除学员与班级的关系。',
    ],
    effect: 'write',
    prerequisites: [
      '使用当前用户会话、租户与课堂上下文；ids 必须来自同一课堂的最新列表读取结果。',
      '先按 isAdmAdd=1 过滤：这一列是页面"移出"按钮的渲染条件，也是后端接受移出的条件。',
    ],
    inputs: RECORD_REMOVE_INPUTS,
    output: {
      shape: 'undefined',
      fields: [field('$', 'undefined', 'Portal 成功响应没有供调用方消费的业务 data；SDK 等待请求完成后返回 undefined。')],
      empty: '正常空回执；undefined 不能证明已经移出，必须重新读取同一课堂的学习记录列表核对。',
    },
    consume: [
      '请求体严格是 `["<id>", …]` 的数组本身，不是 `{ ids: [...] }`；这一点与"学习管理"的批量删除同形，与本模块学生的 moveOut 批量删除也同形。',
      '成功或超时后都重新读取同一 lessonId 的学习记录列表，确认目标 id 已不在 list 里；不要用"HTTP 成功"当结论。',
    ],
    steps: [
      { role: 'recovery', when: '请求成功、超时或响应丢失后需要确认最终业务状态', capabilityId: 'study-lesson-weekly-record-list', mapping: { lessonId: 'context.lessonId' }, instruction: '按同一课堂重新读取学习记录列表，逐条核对目标 id 是否还在；列表里少了才算移出成功。' },
    ],
    completion: '同一课堂的学习记录列表里不再出现这些 id 后，才能报告移出完成。',
    failures: [
      'ids 为空或含非法 ID 时在发请求前抛错（页面在选择为空时按钮本就是禁用的）。',
      '**后端有业务失败分支**：只要这批 id 里有一条 `is_adm_add = 0`（学员自学产生的记录），service 直接返回 -1，控制器把它转成 `ret:"FAIL", code:500, msg:"线上学习学员不可移出，请重新选择"`（`StudyStudyRecordServiceImpl:349-357` + `StudyStudyRecordController:99-108`）。',
      '拿到上面那条错时**不要重试、也不要少传几条试探**：先回到列表读 isAdmAdd，把 0 的行从这一批里剔除，并如实告诉用户"这几条是学员自学记录，不能移出"。',
      '权限、租户或网络错误按原错误处理；不要把失败的批量当成部分成功。',
    ],
    idempotency: '端点没有 requestId；重复移出同一批 id 不会新建记录（记录已经不在），但成功与否仍要按同一 lessonId 回查列表确认。',
    evidence: hiddenEvidence,
    gaps: [
      ...hiddenGaps,
      '未在真实测试环境执行过移出：`-1` 那条失败分支的形状来自固定后端检出（service 返回值 + 控制器 fail 文案），未记录真实响应体。',
      '成功响应是空回执还是带 data（控制器只 `CommonResult.result()` 不带 data），未在真实环境确认；SDK 按"无业务 data"处理。',
    ],
  },

  'study-lesson-monthly-motion-list': {
    purpose: '读取某个「月课堂」下的全部议案，供会议决议弹窗/列表选择；返回的每一行带议案内容、附件与决议字段。',
    whenToUse: '在月课堂的「会议决议」子页查看或选中某条议案时使用；只读。',
    boundaries: [
      ...commonBoundaries,
      '本能力只服务月课堂的隐藏子页 `monthly-lesson/meeting-resolution/[mode]/[id]/item-list.vue`；它按 lessonId 取该课堂的全部议案，不做审核状态过滤（与“评分记录”用的那个接口不同，见 study-lesson-monthly-motion-rate-list）。',
      '**名称筛选是页面在本地做的**：`name` 不会进入请求。第 2 条约束的理由是页面 `customLoad` 的行为（`item-list.vue:66-75`），不是后端没有该能力 —— 照页面原样做才不会在"同一个接口两个行为"上分叉。',
      '返回的是议案（议题）数据，不是投票结果；页面另外调用决议详情/总议案接口时 SDK 未覆盖（见 gaps）。',
    ],
    effect: 'read',
    prerequisites: [
      '使用当前用户会话、租户与月课堂页面权限（/dashboard/lesson/monthly-lesson）。',
      'lessonId 来自月课堂列表返回的 list[].id；motionId 来自本能力返回的 list[].id。',
    ],
    inputs: {
      lessonId: hiddenParam('当前月课堂 ID。', 'study-lesson-monthly-list 返回的 list[].id', { type: 'string | number', required: true }),
      name: hiddenParam(
        '议案名称过滤；**只在本地按 includes 过滤**，不发到服务端。',
        '用户输入的议案名称片段',
        { type: 'string', required: false, omitted: '不传时返回服务端返回的全部议案', constraints: ['子串匹配，不是模糊拼音或分词'] },
      ),
    },
    output: {
      shape: '{ list: object[], total: number }',
      fields: [
        field('$', 'object', '页面 customLoad 归整后的结果；后端本身返回的是数组。'),
        field('list', 'object[]', '议案行（本地过滤后）。'),
        field('total', 'number', '本地过滤后的条数；**不是后端报告的总数**（页面把 total 设成过滤结果的长度）。'),
        field('list[].id', 'string | number', '议案 ID；openTotalMotion/getResolutionInfo 与督办任务都用它，不是课堂 ID。'),
        field('list[].name', 'string | null', '议案名称。', { nullable: true, nullMeaning: '后端未返回；页面本地过滤时这一行会抛错，SDK 按空串处理' }),
        field('list[].lessonName', 'string | null', '所属课程名称（页面"所属课程"列）。', { nullable: true, nullMeaning: '后端未返回' }),
        field('list[].isTotalMotion', 'number | null', '是否总议案：1 是总议案（决议弹窗走"合并展示"分支）。', { nullable: true, values: { '0': '分议案', '1': '总议案' }, nullMeaning: '后端未返回，弹窗按分议案渲染' }),
        field('list[].motionContentType', 'number | null', '议案内容类型：1 填写内容、2 文件。', { nullable: true, values: { '1': '填写内容', '2': '文件' }, nullMeaning: '后端未返回' }),
        field('list[].motionContent', 'string | null', '议案内容（类型 1 时是正文）。', { nullable: true, nullMeaning: '没有内容' }),
        field('list[].motionFileName', 'string | null', '议案附件名（类型 2 时展示）。', { nullable: true, nullMeaning: '没有附件' }),
        field('list[].motionFileUrl', 'string | null', '议案附件 URL；页面交给文件预览组件打开。', { nullable: true, nullMeaning: '没有附件' }),
        field('list[].isPass', 'number | null', '议案是否通过：1 通过。', { nullable: true, values: { '0': '不通过', '1': '通过' }, nullMeaning: '尚未表决' }),
      ],
      empty: 'list=[] 表示这个课堂没有（或名称过滤后没有）议案；权限与网络错误照常抛出，不降级为空结果。',
    },
    consume: [
      '列表展示用 name / lessonName；点击"查看"时把 list[].id 交给决议详情弹窗，把 isTotalMotion 一起带过去决定渲染分支。',
      '`name` 传了就只在本地过滤，且 total 会跟着变成过滤后的条数；要"后端报告的总数"只能用不带 name 的调用。',
      '"下载"按钮走的是一个前端页面路由（/simple/education/download/month-proposal），不是 JSON 接口，SDK 未覆盖。',
    ],
    steps: [
      { role: 'optional', when: '用户要查看某条议案的评分记录', capabilityId: 'study-lesson-monthly-rate-list', mapping: { motionId: 'result.list[].id' }, instruction: '评分记录按议案维度查询，只传 motionId，不要传课堂 ID 或环节 ID。' },
      { role: 'optional', when: '用户要查看某条议案上的督办任务', capabilityId: 'study-lesson-monthly-oversee-task-list', mapping: { lessonId: 'args.lessonId', motionId: 'result.list[].id' }, instruction: '两个 ID 都要：课堂 ID 当 businessId、议案 ID 当 featureId，不能互换。' },
    ],
    completion: '返回该月课堂的议案列表（或本地过滤后的子集）；读取不改变表决与决议数据。',
    failures: [
      'lessonId 缺失或非正整数时在发请求前抛错。',
      '权限、租户与响应形状错误原样抛出；不能把空议案列表解释成"这个课堂没有开过会"。',
    ],
    idempotency: null,
    evidence: hiddenEvidence,
    gaps: hiddenGaps,
  },

  'study-lesson-monthly-motion-rate-list': {
    purpose: '读取某个「月课堂」下**已发布课堂**的议案列表，供「评分记录」页选择要看的议案。',
    whenToUse: '在月课堂的「评分记录」子页按议案名称查找议案、再点"查看"打开评分明细时使用；只读。',
    boundaries: [
      ...commonBoundaries,
      '本能力只服务月课堂的隐藏子页 `monthly-lesson/score-record/[id]/item-list.vue`；页面 `getDataListIsPage: false`，所以**没有 pageNo/pageSize**，它一次返回全部命中行。',
      '与 `study-lesson-monthly-motion-list` 打的是**两个不同接口**：那一个是 `getMotionByLesson`（按 lessonId 取全部议案、名称本地过滤），本能力是 `getMotionRateListByLesson`（名称走服务端 LIKE，且 SQL 额外要求 `hr_study_lesson.status = 1`，即**只返回已发布课堂的议案**）。两者不能互换。',
      '返回的只是议案本身，不含任何评分；评分明细要再用 study-lesson-monthly-rate-list 按 motionId 查。',
    ],
    effect: 'read',
    prerequisites: [
      '使用当前用户会话、租户与月课堂页面权限（/dashboard/lesson/monthly-lesson）。',
      'lessonId 来自月课堂列表返回的 list[].id。',
    ],
    inputs: {
      lessonId: hiddenParam('当前月课堂 ID。', 'study-lesson-monthly-list 返回的 list[].id', { type: 'string | number', required: true }),
      name: hiddenParam('议案名称，**服务端** LIKE 模糊匹配（与 getMotionByLesson 的本地过滤相反）。', '用户输入的议案名称片段', { type: 'string', required: false, omitted: '发送空字符串，不过滤' }),
    },
    output: {
      shape: 'object[]',
      fields: [
        field('$', 'object[]', '议案数组（后端直接返回数组，页面列表模块把它当 list 用）。'),
        field('[].id', 'string | number', '议案 ID；打开评分明细弹窗时作为 motionId。'),
        field('[].name', 'string | null', '议案名称（页面"所属议案"列）。', { nullable: true, nullMeaning: '后端未返回' }),
        field('[].lessonName', 'string | null', '所属课程名称（页面"所属课程"列）。', { nullable: true, nullMeaning: '后端未返回' }),
      ],
      empty: '[] 表示该课堂（或该名称）下没有可评分的议案；非分页结构，不读取 list/total。',
    },
    consume: [
      '用 [].id 打开评分明细；页面在这一层没有勾选、没有批量动作。',
      '因为后端要求课堂已发布，草稿状态的月课堂查不到议案时先确认课堂状态，不要当成"没有议案"。',
    ],
    steps: [
      { role: 'required', when: '用户点"查看"打开某条议案的评分明细', capabilityId: 'study-lesson-monthly-rate-list', mapping: { motionId: 'result.[].id' }, instruction: '只把议案 ID 当 motionId 传过去；staffName 留空表示看全部评分人。' },
    ],
    completion: '返回该月课堂下（名称命中的）议案数组；读取不改变议案与评分。',
    failures: [
      'lessonId 缺失或非正整数时在发请求前抛错。',
      '权限、租户与响应形状错误原样抛出；空数组只表示当前条件下没有议案。',
    ],
    idempotency: null,
    evidence: hiddenEvidence,
    gaps: hiddenGaps,
  },

  'study-lesson-monthly-rate-list': {
    purpose: '读取某条议案的全部评分明细（评分人、鲜花数、评价内容、评分时间）。',
    whenToUse: '用户在「评分记录」里点开某条议案后查看谁给过评分、给了几朵花时使用；只读。',
    boundaries: [
      ...commonBoundaries,
      '本能力只服务月课堂隐藏子页 `score-record/[id]/components/score-record.vue` 打开的弹窗；它的表**没有分页控件**，页面 `:pagination="false"`，一次返回全部。',
      '**HTTP 方法是 POST，但实现是纯读**：`StudyLessonMotionServiceImpl#getRateListByMotionId` 只有一次 select + 字典/用户回填 + 内存过滤，没有任何 insert/update。所以这里按 `read` 登记，不按方法名或方法判定。',
      '后端只认排序白名单 `flower` / `rate_time`（且要求两个字段同时给），页面没有排序控件、也不发这两个参数，所以 SDK 不开放它们。',
    ],
    effect: 'read',
    prerequisites: [
      '使用当前用户会话、租户与月课堂页面权限（/dashboard/lesson/monthly-lesson）。',
      'motionId 必须来自 study-lesson-monthly-motion-rate-list 返回的 [].id 或 study-lesson-monthly-motion-list 的 list[].id。',
    ],
    inputs: {
      staffName: hiddenParam(
        '评分人姓名；后端在**内存里**做 contains 过滤（不是 SQL LIKE）。',
        '用户输入的评分人姓名',
        { type: 'string', required: false, omitted: '发送空字符串，返回全部评分人' },
      ),
      motionId: hiddenParam('议案 ID；不是课堂 ID，也不是班课环节 ID。', 'study-lesson-monthly-motion-rate-list 返回的 [].id', { type: 'string | number', required: true }),
    },
    output: {
      shape: 'object[]',
      fields: [
        field('$', 'object[]', '评分记录数组；页面表格直接渲染这个数组。'),
        field('[].id', 'string | number | null', '评分记录 ID。', { nullable: true, nullMeaning: '后端未返回' }),
        field('[].motionId', 'string | number | null', '议案 ID。', { nullable: true, nullMeaning: '后端未返回' }),
        field('[].staffCode', 'string | number | null', '评分人工号；不是用户 ID。', { nullable: true, nullMeaning: '后端未返回' }),
        field('[].staffName', 'string | null', '评分人姓名；**后端按工号回填，查不到用户时为 null**。', { nullable: true, nullMeaning: '工号在用户表里找不到对应的人' }),
        field('[].flower', 'number | null', '鲜花数原值 0-6（数据库值）。', { nullable: true, nullMeaning: '后端未返回' }),
        field('[].flowerStr', 'string | null', '展示用评分结果：flower+1；flower=6 时固定为 "6+"。', { nullable: true, nullMeaning: '后端未返回' }),
        field('[].flowerContent', 'string | null', '评价内容；由 `motion_flower` 字典按 flower 取 label，字典缺项时为 null。', { nullable: true, nullMeaning: '字典里没有对应档位' }),
        field('[].rateTime', 'string | null', '评分时间。', { nullable: true, nullMeaning: '后端未返回' }),
      ],
      empty: '[] 表示这条议案还没有人评分；非分页结构，不读取 list/total。',
    },
    consume: [
      '页面"评分结果"列显示的是 flowerStr（不是 flower），两者差值固定为 1，flower=6 时是 "6+"；要展示分数就用 flowerStr，要统计原始档位才用 flower。',
      '"评价"列显示 flowerContent，它来自字典而非评分人自由输入。',
      '页面有本地排序（按 flowerStr 数值、按 rateTime），SDK 返回服务端顺序，排序由调用方自己做。',
    ],
    steps: [],
    completion: '返回该议案的评分明细数组；读取不改变评分。',
    failures: [
      'motionId 缺失或非正整数时在发请求前抛错。',
      '权限、租户与响应形状错误原样抛出；空数组只表示还没有评分。',
      '弹窗里的"导出"是另一个接口（POST /admin-api/study/lesson/studylesson/exportMotionRateInfo，二进制响应），SDK 未覆盖。',
    ],
    idempotency: null,
    evidence: hiddenEvidence,
    gaps: hiddenGaps,
  },

  'study-lesson-monthly-oversee-task-list': {
    purpose: '读取挂在这条议案上的督办任务（任务名、紧急程度、被督办人、计划完成时间、是否完成）。',
    whenToUse: '在会议决议弹窗的"督办记录"区域查看/撤销/提醒督办任务时使用；本能力只读，撤销与提醒是另外的接口。',
    boundaries: [
      ...commonBoundaries,
      '本能力只服务 `view-meeting.vue` 的"督办记录"区块；它属于 hr 督办模块（`/hr/oversee-task/**`），不是学习模块的接口。',
      '`type` 是页面写死的业务类型 1（月课堂议案），SDK 钉死不发调用方参数；`businessId` 收的是**课堂 ID**、`featureId` 收的是**议案 ID**，两者不能互换。',
      '页面给每条记录本地加了 `isSend: false` 并按 isComplete 把未完成的排到前面；`isSend` 是弹窗自己的按钮状态、不是后端字段，SDK 不伪造它、也不重排服务端顺序。',
      '弹窗里的"撤销"（DELETE /admin-api/hr/oversee-task/delete）和"发送提醒"（GET /admin-api/hr/oversee-task/sendMessage）是写操作，本能力不覆盖它们。',
    ],
    effect: 'read',
    prerequisites: [
      '使用当前用户会话、租户与月课堂页面权限（/dashboard/lesson/monthly-lesson）。',
      'lessonId 来自月课堂列表 list[].id；motionId 来自议案列表 list[].id。',
    ],
    inputs: {
      lessonId: hiddenParam('当前月课堂 ID；请求里叫 `businessId`（业务主表 id）。', 'study-lesson-monthly-list 返回的 list[].id', { type: 'string | number', required: true }),
      motionId: hiddenParam('议案 ID；请求里叫 `featureId`（功能主表 id），不是课堂 ID。', 'study-lesson-monthly-motion-list 返回的 list[].id', { type: 'string | number', required: true }),
    },
    output: {
      shape: 'object[]',
      fields: [
        field('$', 'object[]', '督办任务数组（服务端顺序）。'),
        field('[].id', 'string | number', '督办任务 ID；撤销/查看详情用它，不是议案 ID。'),
        field('[].taskName', 'string | null', '督办任务名称。', { nullable: true, nullMeaning: '后端未返回' }),
        field('[].degreeType', 'number | null', '紧急程度原码；页面用 `degreeTypeOptions` 翻译成标签。', { nullable: true, nullMeaning: '后端未返回' }),
        field('[].tip', 'string | null', '提示内容（页面灰色小字）。', { nullable: true, nullMeaning: '后端未返回' }),
        field('[].endDate', 'string | null', '计划完成时间（`YYYY-MM-DD`）。', { nullable: true, nullMeaning: '后端未返回' }),
        field('[].isComplete', 'number | null', '是否已完成：1 已完成。**未完成的（非 1）才显示撤销/发送提醒**。', { nullable: true, values: { '0': '未完成', '1': '已完成' }, nullMeaning: '后端未返回' }),
        field('[].isCreator', 'number | null', '是否当前登录人创建：只有 1 才渲染撤销与提醒按钮。', { nullable: true, values: { '0': '不是本人创建', '1': '本人创建' }, nullMeaning: '后端未返回' }),
        field('[].superviseeList', 'object[] | null', '被督办人列表；页面把每个元素的 superviseeName 用中文逗号连起来显示。', { nullable: true, nullMeaning: '没有被督办人' }),
        field('[].superviseeList[].superviseeName', 'string | null', '被督办人姓名；不是 ID。', { nullable: true, nullMeaning: '后端未返回' }),
      ],
      empty: '[] 表示这条议案还没有督办任务；非分页结构，不读取 list/total。',
    },
    consume: [
      '展示顺序按服务端返回；页面会把未完成的排前面，需要同样效果时由调用方按 isComplete 自行排序。',
      '按钮可见性要同时看 `isComplete !== 1` 与 `isCreator === 1`；`isSend` 是页面本地状态，不要从返回值里找它。',
      '详情/撤销/提醒都会跳到或打到别的地方（分别是 urge-detail 路由、DELETE /delete、GET /sendMessage），SDK 未覆盖，见 gaps。',
    ],
    steps: [],
    completion: '返回这条议案下的督办任务数组；读取本身不改变任务状态，也不发送提醒。',
    failures: [
      'lessonId 或 motionId 缺失、非正整数时在发请求前抛错。',
      '权限、租户与响应形状错误原样抛出；空数组只表示没有督办任务。',
    ],
    idempotency: null,
    evidence: hiddenEvidence,
    gaps: [
      ...hiddenGaps,
      '同一弹窗里的督办"撤销""发送提醒""详情"没有对应的 SDK 能力，本次未覆盖（派单表未列入）。',
    ],
  },
}

// 契约与能力定义必须一一对应：多一个少一个都在这里暴露，而不是等到 describe() 返回空说明。
const hiddenMethodIds = Object.keys(STUDY_LESSON_HIDDEN_METHODS)
const hiddenMismatch = hiddenMethodIds.filter(id => !hiddenContracts[id]).concat(Object.keys(hiddenContracts).filter(id => !hiddenMethodIds.includes(id)))
if (hiddenMismatch.length > 0) throw new Error(`study-lesson 隐藏子页契约映射不一致：${hiddenMismatch.join(',')}`)
for (const id of hiddenMethodIds) {
  if (!hiddenDefinitions.has(id)) throw new Error(`study-lesson 隐藏子页契约没有能力定义：${id}`)
  const params = hiddenDefinitions.get(id)!.params
  const inputs = hiddenContracts[id]!.inputs
  const missingInput = params.filter(param => inputs[param.name] === undefined)
  if (missingInput.length > 0) throw new Error(`${id} 的契约缺少参数说明：${missingInput.map(p => p.name).join(',')}`)
}

/** 隐藏子页/弹窗的 AI 契约；接线由派单方负责（见本节顶部注释）。 */
export const STUDY_LESSON_HIDDEN_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  hiddenMethodIds.map(id => [id, hiddenContracts[id]!]),
)

/** 同一组能力的公开方法路径契约（键形如 `studyLesson.listDailyRecords`）。 */
export const STUDY_LESSON_HIDDEN_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(STUDY_LESSON_HIDDEN_METHODS).map(([capabilityId, method]) => [
    `studyLesson.${method}`,
    {
      ...hiddenContracts[capabilityId]!,
      boundaries: [
        ...hiddenContracts[capabilityId]!.boundaries,
        `这是公开门面 sdk.studyLesson.${method}；参数按本契约 inputs 传入，不要绕过页面上下文另拼 module-type。`,
      ],
    },
  ]),
)
