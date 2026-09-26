import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { STUDY_RECORD_HIDDEN_METHODS, studyRecordHiddenCapabilities } from '../capabilities/study-record.js'

/**
 * 学习管理页上**由弹窗发出**的四个能力的 AI 契约。
 *
 * 这一页原有的 `study-record-list` 契约在 `contracts-business.ts` 里（属权威目录，本文件不动它）。
 * 本文件按 `contracts-study-course.ts` 的自包含写法维护新增部分，**还没有接进
 * `src/catalog/ai-contracts.ts` / `contracts-business.ts`** —— 接线由派单方统一做。
 *
 * 四个能力的共同点是"请求不在列表页上"：列表页的行按钮打开
 * `components/link-view.vue`（"请选择环节"），link-view 再按环节状态打开
 * `components/assignment.vue`（"作业详情"/"评分"）。两个弹窗各自带 `http.get`/`http.post`。
 */

const definitions = new Map(studyRecordHiddenCapabilities.map(definition => [definition.id, definition]))

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: false,
  nullable: false,
  ...extra,
})

const parameter = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning,
  source,
  required: true,
  ...extra,
})

const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => parameter(
  meaning,
  source,
  { required: false, omitted, ...extra },
)

const idInput = (meaning: string, source: string): AiParameter => parameter(meaning, source, {
  type: 'string | number',
  constraints: ['安全正整数或无前导零的正整数字符串；长 ID 保留字符串，不能用名称或行号代替。'],
})

const commonEvidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:6ac274fc9e app/portal/views/dashboard/education/study/study/list.vue、components/link-view.vue、components/assignment.vue、app/portal/views/dashboard/education/assignment/assignment/record/[assignmentId]/item-list.vue',
    kind: 'reference',
    note: '核对两级弹窗的实际请求（URL、方法、参数键序与 String() 转换）、按钮禁用条件（checkPermission 返回值）、评分字段的二选一逻辑与提交载荷键序。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:77fbc2a206c StudyLessonLinkController#selectStudyDetail、StudyAssignmentSubmitRecordController#get/update、StudyAssignmentController#checkPermission、StudyLessonLinkServiceImpl、StudyAssignmentSubmitRecordServiceImpl、StudyAssignmentServiceImpl#checkPermission/getAssignmentStatus、AppLessonLinkDTO、StudyAssignmentSubmitRecordDTO、APPLessonLinkStatusDTO',
    kind: 'reference',
    note: '核对环节状态码的判定分支、info 接口的条件写（isRead=1）、update 的 flower→score 字典换算与推送/重算副作用、checkPermission 的三种放行身份；固定检出静态证据不代表已部署版本。',
  },
  {
    source: 'src/capabilities/study-record.ts',
    kind: 'implementation',
    note: '锁定 STUDY_RECORD_HIDDEN_METHODS、参数装配顺序、id 校验、评分字段二选一与请求体键序。',
  },
  {
    source: 'test/study-record.test.ts',
    kind: 'test',
    note: '覆盖参数装配与顺序、返回结构断言、以及"get 也会写 isRead"和"两个评分字段只能给一个"这两条关键语义；离线断言不替代真实测试环境读取。',
  },
]

const gaps: string[] = [
  '本轮未在真实测试环境执行这四个请求：参数形状与读写语义来自固定 Portal/Java 检出与离线测试，未取得真实响应体。',
  '`info` 接口的 isRead 写入没有独立回查手段（返回体里的 isRead 是写入前的值），所以"是否真的写成 1"在真实环境也需要另行确认。',
]

const contracts: Record<string, AiContract> = {
  'study-record-lesson-detail': {
    purpose: '读取某个学员在某班课里的全部环节，并带上后端**按学员身份**算出的环节状态码（"已完成 / 待提交 / 待自评 / 已截止"）。',
    whenToUse: '在学习管理列表里点某行的"查看详情"、需要知道这个学员在这个班课里有哪些环节、哪些环节能继续操作时使用；只读。',
    boundaries: [
      '权限码为 /dashboard/study/study；页面上下文由 SDK 绑定，调用方不要另拼 module-type。',
      '`type`（1 课程 / 2 作业 / 3 考试）与 `linkStatusCode` 是两个字段：**只有 `type === 2` 的行才是作业环节**，页面也只对 `type === 2` 且 `linkStatusCode ∈ {1,3,5}` 的行渲染可点按钮。把 `linkStatusCode` 当成通用的"完成状态"用在课程环节上会读错。',
      '`linkStatusCode` / `linkStatusStr` 是后端现算的（依据该学员的学习记录状态与环节截止时间），不是库表字段，也**不是** `list.vue` 那一层的班课状态。',
      '`id` 是班课环节 ID、`resourceId` 是远端作业/课程 ID、`lessonId` 是班课 ID：三者不是同一个东西，下一步各自用对了才不会查空。',
    ],
    effect: 'read',
    prerequisites: [
      '使用当前用户会话、租户与学习管理页面权限；结果只代表当前数据范围。',
      'lessonId 与 staffCode 必须来自同一行学习记录（list[].lessonId / list[].staffCode），不能用姓名或工号字符串猜。',
    ],
    inputs: {
      lessonId: idInput('班课 ID；来自学习管理列表行的 list[].lessonId。', 'study-record-list 返回的 list[].lessonId'),
      staffCode: idInput('学员工号；来自学习管理列表行的 list[].staffCode，不是用户 ID。', 'study-record-list 返回的 list[].staffCode'),
    },
    output: {
      shape: 'object[]',
      fields: [
        field('$', 'object[]', '该学员在这个班课里的环节数组（后端按列表顺序返回）。'),
        field('[].id', 'string | number', '班课环节 ID；查作业答案（linkId）用它，不是作业 ID。'),
        field('[].title', 'string | null', '环节名称。', { nullable: true, nullMeaning: '后端未返回名称' }),
        field('[].type', 'number | null', '环节类型：1 课程、2 作业、3 考试。', { nullable: true, values: { '1': '课程', '2': '作业', '3': '考试' }, nullMeaning: '后端未返回类型（页面按非作业渲染）' }),
        field('[].lessonId', 'string | number | null', '所属班课 ID。', { nullable: true, nullMeaning: '后端未返回' }),
        field('[].resourceId', 'string | number | null', '关联的课程/作业/考试 ID；作业环节查权限（assignmentId）用它。', { nullable: true, nullMeaning: '环节没有关联资源' }),
        field('[].linkStatusCode', 'number | null', '环节状态码（后端按学员身份算）。作业环节：1 已完成、2 待提交、3 待自评、4 已截止(未提交)、5 已截止(已提交)；课程环节另有 1 已完成、2 待学习、3 学习中、4 已截止。', { nullable: true, nullMeaning: '后端没有算出状态' }),
        field('[].linkStatusStr', 'string | null', '状态文案（与 linkStatusCode 同源，直接展示即可）。', { nullable: true, nullMeaning: '后端未返回文案' }),
        field('[].teacherScore', 'number | null', '作业环节的讲师打分；学员身份下为 null。', { nullable: true, nullMeaning: '不是讲师身份或还没有打分' }),
        field('[].selfScore', 'number | null', '自评分。', { nullable: true, nullMeaning: '还没有自评' }),
        field('[].startStudyTime', 'string | null', '开始学习时间。', { nullable: true, nullMeaning: '还没有学习记录' }),
        field('[].completeStudyTime', 'string | null', '完成学习时间。', { nullable: true, nullMeaning: '还没有完成' }),
        field('[].studyTime', 'number | null', '学习时长原值；页面不换算单位，SDK 同样不换算。', { nullable: true, nullMeaning: '后端未返回' }),
        field('[].interactionNum', 'number | null', '互动次数。', { nullable: true, nullMeaning: '后端未返回' }),
      ],
      empty: '[] 表示这个学员在这个班课里没有可见环节；权限、网络或响应形状错误照常抛出，不降级为空数组。',
    },
    consume: [
      '按 `type === 2 && (linkStatusCode === 1 || linkStatusCode === 3 || linkStatusCode === 5)` 挑出"页面会把这一行渲染成按钮"的作业环节；其余行的 linkStatusStr 只作文案展示。',
      '要继续看答案或评分时，把 `[].id` 当 linkId、`[].resourceId` 当 assignmentId，两层 ID 都要用；只传其中一个会被后端当成参数缺失。',
      '`linkStatusStr` 直接用后端文案，不要自己按 code 编中文。',
    ],
    steps: [
      { role: 'optional', when: '用户点开某个 type=2 的作业环节', capabilityId: 'study-record-assignment-get', mapping: { linkId: 'result.[].id', staffCode: 'args.staffCode' }, instruction: '环节 ID 与学员工号都要照传；不要用 resourceId 代替 linkId。' },
    ],
    completion: '返回该学员在该班课的环节数组及逐行状态；读取不改变任何学习记录。',
    failures: [
      'lessonId 或 staffCode 缺失、非正整数时在发请求前抛错。',
      '权限、租户、网络或响应形状错误按原错误处理；空数组只表示没有可见环节。',
    ],
    idempotency: null,
    evidence: commonEvidence,
    gaps,
  },

  'study-record-assignment-get': {
    purpose: '读取某学员在某个作业环节上的答案（文字/图片/文件/视频）、自评与讲师评分，供"作业详情/评分"弹窗展示。',
    whenToUse: '讲师或评分人点开某学员的作业准备评分时使用。**名字是"查看"，但它是条件性写操作**：讲师或评分人调用会把这条提交记录标记为已读。',
    boundaries: [
      '权限码为 /dashboard/study/study；页面上下文由 SDK 绑定。',
      '**条件性写**：后端只在 `班课讲师 == 当前登录人工号` 或 `环节评分人 == 当前登录人工号` 时执行 `updateById({ id, isRead: 1 })`（`StudyAssignmentSubmitRecordServiceImpl:229-234`）。其他角色（例如教务）调用不写。写的是"已读"标记，不是业务数据，所以它没有可回滚的语义。',
      '`linkId` 是**班课环节 ID**、`staffCode` 是**学员工号**；后端的形参就是 `Long staffCode, Long linkId`，两个都是 Long，换成用户名或环节名会直接查不到。',
      '学员没有提交记录时**不报错**：后端返回一个几乎全空的对象（只有 submitStatus/submitType/scoreSubmitType 被填上）。判断"有没有提交"要看 `assignmentId` 是否有值，不要看 HTTP 是否成功。',
      '`imageAnswer` / `videoAnswer` 是**逗号串**（后端 join 出来的），页面自己 split(',') 后再逐张展示；不要直接把它们当数组用。',
    ],
    effect: 'write',
    prerequisites: [
      '使用当前用户会话、租户与学习管理页面权限。',
      'linkId 与 staffCode 来自 study-record-lesson-detail 的同一行（[].id 与当前查询用的 staffCode）。',
    ],
    inputs: {
      linkId: idInput('班课环节 ID；来自 study-record-lesson-detail 返回行的 [].id，不是作业 ID。', 'study-record-lesson-detail 返回的 [].id'),
      staffCode: idInput('学员工号；与查环节详情时用的是同一个值。', 'study-record-list 返回的 list[].staffCode'),
    },
    output: {
      shape: 'object',
      fields: [
        field('$', 'object', '作业提交记录对象；没有提交记录时是几乎全空的对象，不是 null。'),
        field('id', 'string | number | null', '提交记录 ID；讲师评分（update）用的主键就是它。', { nullable: true, nullMeaning: '这位学员没有提交记录' }),
        field('assignmentId', 'string | number | null', '作业要求 ID；**判断"有没有提交"看这个字段**，评分时也回传它。', { nullable: true, nullMeaning: '没有提交记录' }),
        field('linkId', 'string | number | null', '班课环节 ID。', { nullable: true, nullMeaning: '后端未返回' }),
        field('lessonId', 'string | number | null', '班课 ID。', { nullable: true, nullMeaning: '后端未返回' }),
        field('staffCode', 'string | number | null', '学员工号。', { nullable: true, nullMeaning: '后端未返回' }),
        field('studentName', 'string | null', '学员姓名。', { nullable: true, nullMeaning: '查不到学员档案' }),
        field('gradeId', 'string | number | null', '学员所在班级 ID；没有班级关系时为 null。', { nullable: true, nullMeaning: '该学员在这个班课没有班级关系或后端未返回' }),
        field('gradeName', 'string | null', '班级名称。', { nullable: true, nullMeaning: '同上' }),
        field('textAnswer', 'string | null', '文字答案；页面只在非空时展示这一节。', { nullable: true, nullMeaning: '没有文字答案' }),
        field('imageAnswer', 'string | null', '图片答案**逗号串**；空串或 null 表示没有图片答案。', { nullable: true, nullMeaning: '没有图片答案', format: 'URL1,URL2' }),
        field('fileAnswer', 'string | null', '文件答案地址；页面用"文件答案"按钮打开。', { nullable: true, nullMeaning: '没有文件答案' }),
        field('fileAnswerName', 'string | null', '文件答案文件名（按钮上的文字）。', { nullable: true, nullMeaning: '没有文件答案' }),
        field('videoAnswer', 'string | null', '视频答案逗号串。', { nullable: true, nullMeaning: '没有视频答案' }),
        field('selfScore', 'number | null', '自评分。', { nullable: true, nullMeaning: '还没有自评' }),
        field('selfScoreInfo', 'string | null', '自评说明。', { nullable: true, nullMeaning: '没有写自评说明' }),
        field('teacherScore', 'number | null', '讲师已给的分数；页面初始把它填回输入框。', { nullable: true, nullMeaning: '还没有评分' }),
        field('teacherFlower', 'number | null', '讲师已给的鲜花数（评分模式为"送花"时用）。', { nullable: true, nullMeaning: '还没有送花或不是送花模式' }),
        field('createTime', 'string | null', '学员提交时间。', { nullable: true, nullMeaning: '没有提交记录' }),
        field('isRead', 'number | null', '是否已读：0 未读、1 已读。**注意这是本次写入之前的值**（写入发生在返回之后），所以看到 1 只说明"上一次查看已经标记过"。', { nullable: true, values: { '0': '未读', '1': '已读' }, nullMeaning: '后端未返回' }),
        field('submitStatus', 'string | null', '后端拼的提交状态中文文案；没有提交记录时是"未提交"。', { nullable: true, nullMeaning: '后端未返回' }),
        field('submitType', 'number | null', '提交状态码：0 未提交、1 已提交、2 晚交。', { nullable: true, values: { '0': '未提交', '1': '已提交', '2': '晚交' }, nullMeaning: '后端未返回' }),
        field('scoreSubmitType', 'number | null', '自评状态：0 正常、1 晚自评。', { nullable: true, values: { '0': '正常', '1': '晚自评' }, nullMeaning: '后端未返回' }),
      ],
      empty: '没有提交记录时返回的是"几乎全空的对象"（不是 null、也不是 404）：只有 submitStatus="未提交"、submitType=0、scoreSubmitType=0。据此判断"这位学员还没交"，并**不要**把这个响应当成"API 出错"。',
    },
    consume: [
      '展示答案：textAnswer 直接显示；imageAnswer 先按逗号切分再逐张展示；fileAnswer 配 fileAnswerName 做下载/预览入口；videoAnswer 同 imageAnswer。',
      '评分前先用 assignment-check-permission 与 assignmentId 判断"这个人该不该由我来评"，再决定要不要打开评分。',
      '`teacherScore` / `teacherFlower` 只用来回填输入框的初值；页面把 `scoreType`（作业自身的配置，来自另一个接口）决定"打分"还是"送花"——SDK 没有覆盖那个接口，见 gaps。',
      'isRead 是"写入前的值"，不要用它证明本次调用写了什么。',
    ],
    steps: [
      { role: 'required', when: '用户要评分（不是只看）', capabilityId: 'assignment-check-permission', mapping: { assignmentId: 'result.assignmentId', lessonId: 'context.lessonId' }, instruction: '先确认返回 1（允许评分）再准备提交；返回 0 时页面会把提交按钮禁用，SDK 也不该继续提交。' },
      { role: 'optional', when: '用户确认要提交评分', capabilityId: 'study-record-assignment-update', mapping: { id: 'result.id', assignmentId: 'result.assignmentId' }, instruction: '两个 ID 都取本次返回的值；评分字段二选一，由作业配置决定给 teacherScore 还是 teacherFlower。' },
    ],
    completion: '返回该学员该环节的答案与评分现状（可能是一个空对象，表示还没提交）；除条件性的"已读"标记外不改变业务数据。',
    failures: [
      'linkId 或 staffCode 缺失、非正整数时在发请求前抛错。',
      '权限、租户、网络或响应形状错误按原错误处理；不要把一个空对象当成"接口坏了"。',
      '**不要拿它做只读轮询**：讲师/评分人每调用一次就会写一次 isRead（虽然写的是同一个值）。',
    ],
    idempotency: '端点没有 requestId；本次写的是绝对值 isRead=1，重复调用终态相同。',
    evidence: commonEvidence,
    gaps: [
      ...gaps,
      '作业自身的评分模式（`GET /study/assignment/studyassignment/{id}` 的 scoreType）与考试/课程的答案展示路径没有对应的 SDK 能力；评分字段该给哪个由调用方按页面配置自行决定。',
    ],
  },

  'assignment-check-permission': {
    purpose: '只读预检：判断当前登录用户是否可以给这个作业的学员评分（返回 1 可以 / 0 不可以）。',
    whenToUse: '打开评分弹窗、或准备提交评分之前调用；它是评分这条写链路的**只读预检**，本身不写任何数据。',
    boundaries: [
      '权限码为 /dashboard/study/study（发出它的页面是学习管理页，不是作业管理页）；作业管理页的"评分"按钮打开的是同一个弹窗组件。',
      '后端放行三种身份：**作业创建人**（用户 ID 比）、**班课讲师**（工号比）、**班课关联班级的助教**（工号比）；都不匹配就返回 0（`StudyAssignmentServiceImpl#checkPermission`）。',
      '`assignmentId` 是作业要求 ID、`lessonId` 是班课 ID；作业管理页那边传的是行里的 `record.lessonId`，学习管理页那边传的是环节所在班课，两者不能互换。',
      '它只是页面级的前端门禁（返回 0 时把提交按钮禁用），**不替代服务端鉴权**：真正的拒绝仍可能发生在提交时，那时要如实报错。',
    ],
    effect: 'read',
    prerequisites: [
      '使用当前用户会话、租户与页面权限；判断结果只对当前登录人成立。',
      'assignmentId 来自 study-record-assignment-get 的 assignmentId（或环节详情的 resourceId），lessonId 来自当前页面上下文。',
    ],
    inputs: {
      assignmentId: idInput('作业要求 ID；来自作业提交记录的 assignmentId 或环节的 resourceId。', 'study-record-assignment-get 返回的 assignmentId / study-record-lesson-detail 的 [].resourceId'),
      lessonId: idInput('班课 ID；不是环节 ID，也不是作业 ID。', 'study-record-list 返回的 list[].lessonId'),
    },
    output: {
      shape: 'number',
      fields: [field('$', 'number', '1 = 当前用户可以评分；0 = 不可以（也包含参数缺失、作业或班课查不到等所有"算不出允许"的情况）。')],
      empty: '返回的是数字本身而不是对象：**只有 `1` 才是允许**。用 `=== 1` 判断，不要把非零当真，也不要把异常吞掉换成 0。',
    },
    consume: [
      '`result === 1` 才准备提交评分；`result === 0` 时按"这个作业/班课不归我评"处理，并如实告诉用户，而不是换个参数重试。',
      '0 有多个成因（不是创建人/讲师/助教、参数不存在、作业或班课被删），接口不区分它们，SDK 也不会猜。',
    ],
    steps: [
      { role: 'required', when: '预检返回 1 且用户确认提交评分', capabilityId: 'study-record-assignment-update', mapping: { id: 'context.submitRecordId', assignmentId: 'args.assignmentId' }, instruction: '提交用的是**提交记录 ID**（study-record-assignment-get 的 id），不是本次预检的 assignmentId。' },
    ],
    completion: '得到 0/1 的预检结果并据此决定是否继续；本次调用不改变任何数据。',
    failures: [
      'assignmentId 或 lessonId 缺失、非正整数时在发请求前抛错（页面在拿不到 assignmentId 时根本不会发这个请求，而是直接把按钮设为禁用）。',
      '权限、租户、网络或响应形状错误按原错误处理；**不要把异常当成 0**。',
    ],
    idempotency: null,
    evidence: commonEvidence,
    gaps,
  },

  'study-record-assignment-update': {
    purpose: '讲师给某位学员的作业评分：写分数（百分制）或写鲜花数，并触发后端的学生通知与学习任务重算。',
    whenToUse: '用户在评分弹窗里确认提交、且 assignment-check-permission 返回 1 时使用。这是真写，不是准备步骤。',
    boundaries: [
      '权限码为 /dashboard/study/study；页面上下文由 SDK 绑定。',
      '**两个评分字段二选一**：`teacherScore`（百分制整数）或 `teacherFlower`（字典 `assignment_score` 的 value）。页面按作业自身的 scoreType 只发其中一个；后端在收到 flower 时会先按字典把它换算成 teacherScore 再落库，所以两个都给等于让 flower 覆盖分数 —— SDK 在发请求前就拒绝"两个都给"或"一个都不给"。',
      '`id` 是**提交记录 ID**（`hr_study_assignment_submit_record.id`），不是 assignmentId；后端在 id 为空时直接抛"未提交作业"。',
      '写分数是**绝对值**，不是累积或切换；同一个值重发不会算两次。但后端在分数发生变化时会推送消息给学员并重算周学习任务（`recalculateWeeklyStudyTask`），**重复提交同一分数也会走一次推送路径**（`teacherScoreChanged` 只看本次请求里有没有分数字段）。',
      '它改不了"要不要自评""答案截止时间"等作业配置，也不上传任何附件。',
    ],
    effect: 'write',
    prerequisites: [
      '先调用 assignment-check-permission 并确认返回 1。',
      'id 与 assignmentId 都来自 study-record-assignment-get 的同一次返回；分数或鲜花数由用户确认。',
    ],
    inputs: {
      id: idInput('提交记录 ID；来自 study-record-assignment-get 的 id，不是 assignmentId。', 'study-record-assignment-get 返回的 id'),
      assignmentId: idInput('作业要求 ID；原样回传。', 'study-record-assignment-get 返回的 assignmentId'),
      teacherScore: parameter('打分，百分制整数 0-100；与 teacherFlower 二选一。', '用户在评分弹窗输入框里确认的分数（页面 input-number precision=0）', {
        type: 'number',
        required: false,
        requiredWhen: '作业评分模式是"打分"（scoreType=0）时必填；与 teacherFlower 互斥',
        constraints: ['整数', '0 ≤ 值 ≤ 100', '与 teacherFlower 不能同时给'],
      }),
      teacherFlower: parameter('鲜花数；字典 `assignment_score` 的 value，与 teacherScore 二选一。', '用户在评分弹窗选中的花朵数（页面 component-rate，档位来自 assignment_score 字典）', {
        type: 'number',
        required: false,
        requiredWhen: '作业评分模式是"送花"（scoreType=1）时必填；与 teacherScore 互斥',
        constraints: ['正整数', '取值来自 assignment_score 字典的 value（用 base-dict-get 查，不要猜档位）', '与 teacherScore 不能同时给'],
      }),
    },
    output: {
      shape: 'undefined',
      fields: [field('$', 'undefined', 'Portal 成功响应没有业务 data；SDK 等待请求完成后返回 undefined。')],
      empty: '正常空回执；undefined 不能证明分数已经落库，要用 study-record-assignment-get 重新读取核对。',
    },
    consume: [
      '请求体严格是 `{ id, assignmentId, teacherScore }` 或 `{ id, assignmentId, teacherFlower }`，键序与页面 submitData 一致；不要包成 draft、也不要加页面没发的字段。',
      '提交成功后重新调用 study-record-assignment-get 读取同一条记录，确认 teacherScore/teacherFlower 与本次一致；不要用"页面提示评分成功"当独立证据。',
      '后端在这一步可能推送消息给学员：超时或失败后**先回查再决定是否重发**，不要盲目重试。',
    ],
    steps: [
      { role: 'required', when: '请求成功、超时或响应丢失后需要确认最终业务状态', capabilityId: 'study-record-assignment-get', mapping: { linkId: 'context.linkId', staffCode: 'context.staffCode' }, instruction: '用提交前保存的环节 ID 与学员工号重新读取，核对 teacherScore/teacherFlower 已经等于本次提交的值。' },
      { role: 'recovery', when: '返回 401/403 或后端报"未提交作业"等业务错误', capabilityId: 'study-record-lesson-detail', mapping: { lessonId: 'context.lessonId', staffCode: 'context.staffCode' }, instruction: '先重读环节状态，确认这条作业环节对这个学员仍然存在（已经移出课堂的学员不会有提交记录），再决定是否重新走一遍预检。' },
    ],
    completion: '回查确认该提交记录的分数（或鲜花数）等于本次提交值后，才能报告评分完成。',
    failures: [
      'id/assignmentId 缺失或非正整数、两个评分字段都给或都不给、分数越界、鲜花数非正整数时，在发请求前抛错。',
      '后端在 `id` 指向的记录不存在（例如学员已被移出课堂）时抛"未提交作业"；这是业务失败，不要重试，回到列表确认这一行还在不在。',
      '权限、租户、网络或响应形状错误按原错误处理；超时先回查，未确认前不得重发（可能重复推送）。',
    ],
    idempotency: '端点没有 requestId；分数是绝对值写入，重复同样的值终态相同，但每次都会走一次"分数变化"推送/重算分支，所以超时后必须先读取核实再决定是否重发。',
    evidence: commonEvidence,
    gaps: [
      ...gaps,
      '本能力不判断"该给分还是该送花"（那来自作业配置 scoreType，SDK 未覆盖该接口）；调用方需要自己查作业详情后决定传哪个字段。',
    ],
  },
}

// 契约与能力定义必须一一对应：多一个少一个都在这里暴露，而不是等到 describe() 返回空说明。
const methodIds = Object.keys(STUDY_RECORD_HIDDEN_METHODS)
const mismatch = methodIds.filter(id => !contracts[id]).concat(Object.keys(contracts).filter(id => !methodIds.includes(id)))
if (mismatch.length > 0) throw new Error(`study-record 隐藏弹窗契约映射不一致：${mismatch.join(',')}`)
for (const id of methodIds) {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`study-record 隐藏弹窗契约没有能力定义：${id}`)
  const missingInput = definition.params.filter(param => contracts[id]!.inputs[param.name] === undefined)
  if (missingInput.length > 0) throw new Error(`${id} 的契约缺少参数说明：${missingInput.map(p => p.name).join(',')}`)
}

export const STUDY_RECORD_HIDDEN_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  methodIds.map(id => [id, contracts[id]!]),
)

export const STUDY_RECORD_HIDDEN_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(STUDY_RECORD_HIDDEN_METHODS).map(([capabilityId, method]) => [
    `studyRecord.${method}`,
    {
      ...contracts[capabilityId]!,
      boundaries: [
        ...contracts[capabilityId]!.boundaries,
        `这是公开门面 sdk.studyRecord.${method}；参数按本契约 inputs 传入，写操作不要绕过 assignment-check-permission 预检。`,
      ],
    },
  ]),
)
