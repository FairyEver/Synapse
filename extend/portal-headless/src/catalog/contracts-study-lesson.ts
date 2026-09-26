import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  STUDY_LESSON_METHODS,
  studyLessonActionCapabilities,
  studyLessonCapabilities,
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
