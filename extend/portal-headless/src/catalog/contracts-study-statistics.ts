import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  ACTION_DETAILS_TYPE_OPTIONS,
  studyStatisticsCapabilities,
} from '../capabilities/study-statistics.js'

/**
 * 学习管理域「数据统计」五个页面**下钻子路由 / 弹窗**那七条能力的 AI 契约。
 *
 * 五个列表页本身的契约在 `contracts-business.ts`（那一批是上一轮做的）。
 * 这一份**自包含**：只声明本轮新增的七条，由主线接进权威目录。
 *
 * 七条的来源都是「页面只要有任一能力指向它就算覆盖」这条判据漏掉的地方：
 *
 * | 能力 | 触发它的地方 | 不是列表模块发的请求 |
 * | --- | --- | --- |
 * | `study-statistics-student-lesson-list` | 学员统计「实学班课数」列 → `./lesson/item-list` | 是列表模块，但工号来自 route.query |
 * | `study-statistics-student-lesson-detail` | 上一步行内「详情」→ `lesson/detail/[lessonId]` | **不分页**，返回数组 |
 * | `study-statistics-teacher-course-list` | 讲师统计「讲授课程数量」→ `course/[staffCode]/item-list` | 同上 |
 * | `study-statistics-teacher-lesson-list` | 讲师统计「讲师班课数量」→ `lesson/[staffCode]/item-list` | 同上 |
 * | `study-statistics-teacher-score-list` | 讲师统计「整体评价」→ `score/[staffCode]/item-list` | 同上 |
 * | `study-statistics-learning-action-details` | 学习统计个人维度「学习/转发」的「是」→ 弹窗 | `POST` 一个数组接口 |
 * | `study-statistics-grade-lesson-record` | 班级统计行「课堂内容」→ 弹窗 | 只有 `lessonIds` 一个参数 |
 *
 * 这些子路由**都没有菜单项**（`lesson/[staffCode]/item-list.vue` 这类是隐藏路由），
 * 但都由父页面的行/列实际 push 或 `createModal` 到达，所以 `pagePath` 一律绑**可达的父菜单页**。
 */

const definitions = new Map(studyStatisticsCapabilities.map(definition => [definition.id, definition]))

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

const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter =>
  parameter(meaning, source, { required: false, omitted, ...extra })

const idParameter = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter =>
  parameter(meaning, source, {
    type: 'string | number',
    constraints: ['安全正整数或无前导零的正整数字符串；ID 必须来自上一步返回，不能用名称、行号或另一类 ID 代替。'],
    ...extra,
  })

/** 输出字段里的 ID：后端 Long 可能被序列化成字符串，说明里必须点明它属于哪个实体 */
const idField = (path: string, meaning: string): AiField =>
  field(path, 'string | number', `${meaning}；后端把 Long 序列化成字符串时按原样保留，不能用名称、行号或另一类 ID 代替。`)

const pageOutput = (rowFields: AiField[], label: string): AiContract['output'] => ({
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', `${label}分页结果。`),
    field('list', 'object[]', '当前页记录，不是全部记录。'),
    field('list[]', 'object', '一条记录。'),
    ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` })),
    field('total', 'number', '符合筛选条件的总记录数，不是当前页长度。'),
  ],
  empty: 'list=[]表示当前页为空；total=0才表示该筛选没有记录。权限、会话、网络或响应形状错误会抛出，不降级为空页。',
})

const arrayOutput = (rowFields: AiField[], label: string): AiContract['output'] => ({
  shape: 'object[]',
  fields: [
    field('$', 'object[]', `${label}；**这是数组**，不是 {list,total} 分页结构（对应端点在 Portal 上也不分页）。`),
    field('[]', 'object', '一条记录。'),
    ...rowFields.map(item => ({ ...item, path: `[].${item.path}` })),
  ],
  empty: '[]表示这一组条件下没有记录；响应不是数组、或页面依赖的关键数组字段缺失会抛出，不降级为空数组。',
})

const commonBoundaries = [
  '七个请求都从**已登录的父页面**下钻，页面上下文沿用父页：module-type=12（学习管理）、当前会话 token 与 tenant-id 由 SDK 统一负责，调用方不要另拼这些头。',
  '这些子路由没有菜单权限：权限码与父页相同（学员统计 `/dashboard/statistics/student`、讲师统计 `/dashboard/statistics/teacher`、班级统计 `/dashboard/statistics/grade`、学习统计 `/dashboard/statistics/learning`），能打开父页才能到这些下钻。',
  '**只读**：七条全部是查询，页面上下钻动作不写任何数据。',
  'ID 不能互换：学员工号（staffCode）、班课 id（lessonId）、员工 id（staffId）、智慧蛋鸡课程/章节 id（lessonId）是四类不同主键；名称、行号、序号都不是它们的替代品。',
  '页面列里显示的 `type` / `lessonType` / `status` 等字典字段，**取值域没有实测**（基准里没有这些页面的请求），SDK 只按原值透传、不给枚举含义。',
]

const commonPrerequisites = [
  '使用当前用户会话、租户和对应统计页面的权限创建 SDK；所有筛选 ID 必须来自当前租户可见数据或用户明确提供。',
  '下钻类查询的 staffCode / lessonId 一般来自父页列表行（`study-statistics-student-list`、`study-statistics-teacher-list`、`study-statistics-grade-list`），不要向用户索要系统内部 ID。',
]

const commonFailures = [
  '缺失必填 ID、非法 ID 或空数组会在发请求前抛错。',
  '401/403、租户/数据范围、网络、服务端业务错误与响应形状错误原样抛出；不能用空数组、空页或 HTTP 成功代替业务结果。',
  '只读查询在超时或网络失败后可以重试；重试前保留原筛选条件，不要换成"更宽"的筛选以掩盖失败。',
]

const evidence: AiContract['evidence'] = [
  {
    source:
      'CodeReview_Projects_Js@test/portal/main:82651c98c5 app/portal/views/dashboard/education/statistics/{student/lesson/item-list.vue,student/lesson/detail/[lessonId].vue,teacher/course/[staffCode]/item-list.vue,teacher/lesson/[staffCode]/item-list.vue,teacher/score/[staffCode]/item-list.vue,learning/components/action-details.vue,learning/list.vue,grade/components/record.vue,student/list.vue}',
    kind: 'reference',
    note: '逐页核对这七个请求的真实 URL、HTTP 方法、参数名与键序、固定值、行/列到路由的跳转关系以及弹窗参数；同时确认这些子路由没有菜单项。固定检出源码证据，不代表该提交已经部署到测试环境。',
  },
  {
    source:
      'CodeReview_Mall_Platform_Java@test/test:998ce8223fa StudyStatisticsController（getGradeLessonRecord/studentLessonDetail/studentLessonStatisticsList/teacherCourseList/teacherLessonList/teacherScoreList）、ZhdjStaticsController#getActionDetails、StatisticsServiceImpl、TeacherCourseListSelectDTO、TeacherLessonListSelectDTO、TeacherScoreListSelectDTO、StudentLessonStatisticsV1DTO、AppLessonLinkDTO、LessonRecordDTO、ZhdjStudyActionDetailReqVO/RespVO',
    kind: 'reference',
    note: '核对端点方法、参数绑定（含 Long/字符串与逗号分隔的 lessonIds）、后端读取的字段、1~5 题均分与总分字段名、以及 getGradeLessonRecord 的字符串倒序行为；静态源码证据，未在真实环境执行这些请求。',
  },
  {
    source: 'src/capabilities/study-statistics.ts',
    kind: 'implementation',
    note: '锁定能力 ID、方法名、参数装配顺序、不分页端点返回数组、actionType 的取值域与参数校验。',
  },
  {
    source: 'baseline/study-statistics.browser.json',
    kind: 'browser',
    note: '同一批次的浏览器基准**只覆盖五个列表页**（含 class-统计的 POST body 键序），**不包含**本文件这七条下钻请求 —— 它们没有基准，参数形状来自固定检出源码。',
  },
]

const commonGaps = [
  '这七条下钻请求**没有浏览器基准**：`baseline/study-statistics.browser.json` 只抓了五个列表页，所以参数名与键序是**从源码推出来的**（conventions 第 31 条：没有基准的契约只能算推断）。',
  '尚未在真实测试环境执行过这七条请求，也没有为它们做过 prepare/submit 类闭环（它们全是只读）。',
  '字典字段（course_type / lesson_type / lesson_study_status / 环节 type）的取值与含义未核实，只按原值透传。',
]

const evidenceByCapability: Record<string, string> = {
  'study-statistics-student-lesson-list':
    '页面把 `countLessonNum(staffCode, isStarted)` 的结果 push 到 `./lesson/item-list?staffCode=…&isStarted=…`；`getDataListIsPage: true` 所以带 pageNo/pageSize。',
  'study-statistics-student-lesson-detail':
    '页面**没有** `getDataListIsPage`，列表模块因此不加 pageNo/pageSize（`list.js:479`），后端签名为 `studentLessonDetail(Long staffCode, Long lessonId)` 且返回 `List`。',
  'study-statistics-teacher-course-list':
    '`form` 只有 staffCode/type/startTime 三项；`startTime` 绑定的是 `a-date-picker`（单选、`show-time`），**不是区间**，所以没有 +1 天。',
  'study-statistics-teacher-lesson-list':
    '`form` 是 staffCode/title/appraiseNumMin/appraiseNumMax/avgScoreMin/avgScoreMax 六项，页面没有时间筛选。',
  'study-statistics-teacher-score-list':
    '`convertFetchForm` 把 `date` 丢掉后**追加** `startTimeFrom`/`startTimeEnd`（结束日 +1 天），所以这两项排在分页参数之前。',
  'study-statistics-learning-action-details':
    '`actionTypeMap` 只把 `hasView→1`、`hasForward→5`；弹窗只在这两列的「是」上打开，所以 SDK 只开放这两个值，虽然后端 DTO 支持 1~5。',
  'study-statistics-grade-lesson-record':
    '后端 `getGradeLessonRecord(String lessonIds)` 先 `split(",")` 再 `sorted(Collections.reverseOrder())`（**字符串倒序**），`StringUtils.isBlank` 直接返回空列表。',
}

const base = (
  id: string,
  value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>,
): AiContract => ({
  ...value,
  whenToUse:
    '用户要在「学习管理 → 数据统计」的四个统计页上**下钻**看明细时使用：学员统计的班课/环节明细、讲师统计的课程/班课/得分明细、班级统计的课堂内容、学习统计的学习与转发明细。这些是页面行/列点到的那一层，不是父页的列表筛选。',
  boundaries: [...commonBoundaries],
  prerequisites: [...commonPrerequisites],
  failures: [...commonFailures],
  evidence: [
    ...evidence,
    { source: `src/capabilities/study-statistics.ts（${id} 的实现）`, kind: 'implementation', note: evidenceByCapability[id] ?? '' },
  ],
  gaps: [...commonGaps],
})

const contracts: Record<string, AiContract> = {}
const add = (id: string, value: AiContract): void => {
  if (!definitions.has(id)) throw new Error(`Study statistics contract has no capability definition: ${id}`)
  contracts[id] = value
}

const STUDENT_LESSON_FIELDS: AiField[] = [
  idField('lessonId', '班课 id；页面行上的 lessonId 就是下钻明细页的入参'),
  field('staffCode', 'string | number | null', '学员工号；**不是**用户 ID', { nullable: true, nullMeaning: '后端未返回' }),
  field('staffName', 'string | null', '学员姓名', { nullable: true, nullMeaning: '后端未返回' }),
  field('mobile', 'string | number | null', '学员电话（后端 DTO 是 `Long`，可能按数值或字符串返回，不做格式化）', { nullable: true, nullMeaning: '后端未返回' }),
  field('lessonTitle', 'string | null', '班课名称', { nullable: true, nullMeaning: '后端未返回' }),
  field('lessonType', 'string | number | null', '课堂类型（字典 `lesson_type`，页面按字典渲染标签；取值域未核实）', { nullable: true, nullMeaning: '后端未返回' }),
  field('gradeName', 'string | null', '所属班级名称', { nullable: true, nullMeaning: '后端未返回' }),
  field('startTime', 'string | null', '开课时间原值', { nullable: true, nullMeaning: '后端未返回' }),
  field('endTime', 'string | null', '截止时间原值', { nullable: true, nullMeaning: '后端未返回' }),
  field('status', 'string | number | null', '班课状态（字典 `lesson_study_status`；取值域未核实，不要按数值硬编码标签）', { nullable: true, nullMeaning: '后端未返回' }),
  field('interactionNum', 'number | null', '有效互动次数（后端口径：旧智慧蛋鸡全站有效发言）', { nullable: true, nullMeaning: '后端未返回' }),
  field('avgSelfScore', 'number | null', '自评成绩（平均）', { nullable: true, nullMeaning: '后端未返回' }),
  field('avgTeacherScore', 'number | null', '讲师成绩（平均）', { nullable: true, nullMeaning: '后端未返回' }),
]

const STUDENT_LESSON_DETAIL_FIELDS: AiField[] = [
  field('id', 'string | number | null', '环节记录 ID；页面不消费', { nullable: true, nullMeaning: '后端未返回' }),
  idField('lessonId', '环节所在班课的 id'),
  field('title', 'string | null', '环节名称', { nullable: true, nullMeaning: '后端未返回' }),
  field('type', 'number | null', '环节类型原码；页面以 `type` 列原样展示，**没有单位或字典映射证据**', { nullable: true, nullMeaning: '后端未返回' }),
  field('linkStatusCode', 'number | null', '环节状态码；页面用它决定点击跳转到哪个页面（讲师/学员两态）', { nullable: true, nullMeaning: '后端未返回' }),
  field('linkStatusStr', 'string | null', '环节状态的展示文本（页面这一列直接显示它）', { nullable: true, nullMeaning: '后端未返回' }),
  field('startStudyTime', 'string | null', '开始学习时间原值', { nullable: true, nullMeaning: '后端未返回' }),
  field('completeStudyTime', 'string | null', '完成学习时间原值', { nullable: true, nullMeaning: '后端未返回' }),
  field('interactionNum', 'number | null', '互动次数', { nullable: true, nullMeaning: '后端未返回' }),
  field('studyTime', 'number | null', '学习时长原值。⚠️ 后端字段是 `Integer` 且**没有单位说明**，页面也原值展示：SDK 不猜秒/分钟。', { nullable: true, nullMeaning: '后端未返回' }),
  field('selfScore', 'number | null', '自评分', { nullable: true, nullMeaning: '后端未返回' }),
  field('teacherScore', 'number | null', '讲师打分（学员身份时显示）', { nullable: true, nullMeaning: '后端未返回' }),
]

const TEACHER_COURSE_FIELDS: AiField[] = [
  field('name', 'string | null', '讲师姓名', { nullable: true, nullMeaning: '后端未返回' }),
  field('courseName', 'string | null', '课程名称（后端按 type 从远端资源补齐后回填到这一列）', { nullable: true, nullMeaning: '课程不在或远端取不到' }),
  field('type', 'string | number | null', '课程类型（字典 `course_type`；取值域未核实）', { nullable: true, nullMeaning: '后端未返回' }),
  field('gradeName', 'string | null', '所属班级名称', { nullable: true, nullMeaning: '后端未返回' }),
  field('startTime', 'string | null', '讲授时间原值', { nullable: true, nullMeaning: '后端未返回' }),
  field('resourceId', 'string | number | null', '远端课程资源 ID；**不是**本地课程行 ID，页面不消费', { nullable: true, nullMeaning: '后端未返回' }),
]

const TEACHER_LESSON_FIELDS: AiField[] = [
  field('name', 'string | null', '讲师姓名', { nullable: true, nullMeaning: '后端未返回' }),
  field('title', 'string | null', '班课名称', { nullable: true, nullMeaning: '后端未返回' }),
  idField('lessonId', '班课 id；页面不消费，用于与父页对齐'),
  field('appraiseNum', 'number | null', '评分人数', { nullable: true, nullMeaning: '后端未返回' }),
  field('avgScore', 'number | null', '平均得分（后端保留两位小数口径；页面原值展示）', { nullable: true, nullMeaning: '后端未返回' }),
  field('oneAvgScore', 'number | null', '问题一均分；**题号与题干由评价设置（`study-appraise-setting-list`）决定**', { nullable: true, nullMeaning: '后端未返回' }),
  field('twoAvgScore', 'number | null', '问题二均分', { nullable: true, nullMeaning: '后端未返回' }),
  field('threeAvgScore', 'number | null', '问题三均分', { nullable: true, nullMeaning: '后端未返回' }),
  field('fourAvgScore', 'number | null', '问题四均分', { nullable: true, nullMeaning: '后端未返回' }),
  field('fiveAvgScore', 'number | null', '问题五均分', { nullable: true, nullMeaning: '后端未返回' }),
]

const TEACHER_SCORE_FIELDS: AiField[] = [
  field('createTime', 'string | null', '评分时间原值', { nullable: true, nullMeaning: '后端未返回' }),
  field('userName', 'string | null', '评分人姓名', { nullable: true, nullMeaning: '后端未返回' }),
  field('appraiseNum', 'number | null', '评分人数', { nullable: true, nullMeaning: '后端未返回' }),
  field('sumScore', 'number | null', '评价总分', { nullable: true, nullMeaning: '后端未返回' }),
  field('oneScore', 'number | null', '问题一得分', { nullable: true, nullMeaning: '后端未返回' }),
  field('twoScore', 'number | null', '问题二得分', { nullable: true, nullMeaning: '后端未返回' }),
  field('threeScore', 'number | null', '问题三得分', { nullable: true, nullMeaning: '后端未返回' }),
  field('fourScore', 'number | null', '问题四得分', { nullable: true, nullMeaning: '后端未返回' }),
  field('fiveScore', 'number | null', '问题五得分', { nullable: true, nullMeaning: '后端未返回' }),
]

const GRADE_RECORD_FIELDS: AiField[] = [
  idField('lessonId', '班课 id'),
  field('name', 'string | null', '班课名称（页面按「【名称】课堂记录:」渲染）', { nullable: true, nullMeaning: '后端未返回' }),
  field('recordList', 'object[] | null', '课堂环节记录数组；页面逐条按 `recordType` 取字典 `lesson_tag` 的标签再展示 `recordContent`', { nullable: true, nullMeaning: '该班课没有环节记录' }),
  field('recordList[].recordType', 'string | number | null', '环节标签（字典 `lesson_tag`，页面 `tagOptions.find(...)` 取 label；取值域未核实）', { nullable: true, nullMeaning: '后端未返回，页面取值句会抛错' }),
  field('recordList[].recordContent', 'string | null', '环节内容文本', { nullable: true, nullMeaning: '无内容，页面不渲染这一块' }),
  field('imgUrl', 'string | null', '图片地址，**多个用逗号分隔**（页面 `imgUrl.split(",")` 逐张展示）', { nullable: true, nullMeaning: '没有图片' }),
  field('pdfUrl', 'string | null', '附件地址，**多个用逗号分隔**（页面 `pdfUrl.split(",")`）', { nullable: true, nullMeaning: '没有附件' }),
  field('pdfName', 'string | null', '附件名，**与 pdfUrl 按下标一一对应**（页面 `pdfName.split(",")[index]`）', { nullable: true, nullMeaning: '没有附件名' }),
]

const ACTION_DETAIL_FIELDS: AiField[] = [
  field('courseName', 'string | null', '课程（章/节）名称；后端在取不到名称时回填「未知课程」，转发里当前节点可能回填「章节介绍」', { nullable: true, nullMeaning: '后端未返回' }),
  field('staffName', 'string | null', '员工姓名；后端按 `staffId` 查，查不到时是空字符串', { nullable: true, nullMeaning: '后端未返回' }),
  field('completed', 'string | null', '是否完成。⚠️ 这是一个**字符串**（后端 `String`），当前实现里每条返回记录都是「是」—— 列表里只出现真的发生过该行为的记录。不要把它当布尔值。', { nullable: true, nullMeaning: '后端未返回' }),
  field('completionTime', 'string | null', '行为时间原值。⚠️ 后端对「点赞/收藏」不过滤时间范围（只记时间），「观看/评论/转发」才按范围过滤。', { nullable: true, nullMeaning: '后端未返回' }),
]

const studentLessonInputs: Record<string, AiParameter> = {
  staffCode: optional(
    '学员工号。由父页「实学班课数」跳转时带过来；不传就不发这一项。',
    'study-statistics-student-list.list[].staffCode',
    '不发该参数（后端不过滤学员工号）',
    { type: 'string | number' },
  ),
  isStarted: optional(
    '是否已开始。父页跳转时传 1；后端注释：由学员统计「实学班课数」或班课统计「实际学习人数」跳转时传 1，其余时候不传。',
    '父页跳转 query（页面 `countLessonNum(staffCode, isStarted)`）',
    '不发该参数',
    { type: 'string | number' },
  ),
  staffName: optional('学员姓名筛选。', '用户输入', '发送空字符串', { type: 'string', default: '空字符串' }),
  mobile: optional('学员电话筛选。', '用户输入', '发送空字符串', { type: 'string | number' }),
  lessonId: optional(
    '班课 id。从班课统计「实际学习人数」跳过来时才带。',
    '班课统计行上的 lessonIds（拆分后）或用户明确指定',
    '不发该参数',
    { type: 'string | number' },
  ),
  lessonTitle: optional('班课名称筛选。', '用户输入', '发送空字符串', { type: 'string', default: '空字符串' }),
  lessonType: optional('课堂类型（字典 `lesson_type`）；取值域未核实，只透传。', '页面对应下拉', '发送空字符串', { type: 'string | number' }),
  gradeId: optional('所属班级 id。', 'study-grade-search 的候选', '发送空字符串', { type: 'string | number', lookup: { capabilityId: 'study-grade-search', args: { keyword: '用户给出的班级名称关键字' }, valueField: 'list[].id', labelField: 'list[].name' } }),
  status: optional('班课状态（字典 `lesson_study_status`）；取值域未核实，只透传。', '页面对应下拉', '不发该参数', { type: 'string | number' }),
  startTimeCondition: optional('开课时间起，YYYY-MM-DD HH:mm:ss。用 `buildStudyStatisticsLessonTimeRange` 生成。', '用户选择的时间区间', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
  endTimeCondition: optional('开课时间止，**开区间**（结束日次日 00:00:00）。必须与 startTimeCondition 成对。', '用户选择的时间区间', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
  order: optional('排序方向；页面表头排序写 asc/desc。', '列表表头', '发送空字符串', { type: 'string', default: '空字符串' }),
  orderField: optional('排序字段；页面表头排序写列 dataIndex。', '列表表头', '发送空字符串', { type: 'string', default: '空字符串' }),
  pageNo: optional('从 1 开始的页码。', '调用方分页状态', 'SDK 使用 1', { type: 'integer', default: '1', constraints: ['正整数'] }),
  pageSize: optional('每页条数。', '调用方分页状态', 'SDK 使用 20', { type: 'integer', default: '20', constraints: ['正整数'] }),
}

add('study-statistics-student-lesson-list', base('study-statistics-student-lesson-list', {
  purpose: '查询某个学员（或某个班课）在学员统计里下钻出来的班课明细分页，含开课/截止时间、互动次数与自评/讲师平均分。',
  effect: 'read',
  inputs: studentLessonInputs,
  output: pageOutput(STUDENT_LESSON_FIELDS, '学员班课明细'),
  consume: [
    '用 list[].lessonId + list[].staffCode 作为下一步 `study-statistics-student-lesson-detail` 的两个入参，**两者都不能换成姓名或行号**。',
    'avgSelfScore / avgTeacherScore 是列表口径的平均分，没有样本数；不要对多行再做二次平均。',
    'interactionNum 是后端「有效互动」口径，不是消息条数，不要与消息列表计数交叉核对。',
  ],
  steps: [
    { role: 'optional', when: '用户要看某个学员在某个班课里的环节明细', capabilityId: 'study-statistics-student-lesson-detail', mapping: { staffCode: 'result.list[].staffCode', lessonId: 'result.list[].lessonId' }, instruction: '用**同一行**的 staffCode 与 lessonId 一起下钻；只给其中一个会查不到或查到别人的数据。' },
  ],
  completion: '返回当前筛选下的学员班课明细分页；需要完整清单时按同一筛选继续翻页直到覆盖 total，不能把当前页当全集。',
  idempotency: null,
}))

add('study-statistics-student-lesson-detail', base('study-statistics-student-lesson-detail', {
  purpose: '查询一个学员在一个班课里的环节（课次）明细：每个环节的状态、开始/完成时间、互动次数、学习时长与自评/讲师分。',
  effect: 'read',
  inputs: {
    staffCode: optional('学员工号。', 'study-statistics-student-lesson-list.list[].staffCode', '发送空字符串', { type: 'string | number' }),
    lessonId: optional('班课 id。', 'study-statistics-student-lesson-list.list[].lessonId', '发送空字符串', { type: 'string | number' }),
  },
  output: arrayOutput(STUDENT_LESSON_DETAIL_FIELDS, '该学员在该班课下的环节明细'),
  consume: [
    '**返回是数组**（这个端点不分页）：不要读 list/total，也不要用 pageNo 翻页。',
    'studyTime 与 Portal 表格一致按原值展示：后端与页面都没有给单位，SDK 不换算成秒/分钟。',
    'linkStatusStr 是展示文本、linkStatusCode 是页面用来决定跳转目标的码：要用跳转语义时用码，不要反解文本。',
    '按 lessonId + staffCode 组合使用结果，结果里不含这两个入参的字段。',
  ],
  steps: [],
  completion: '返回该学员在该班课下的全部环节记录（空数组表示后端没有返回任何环节）；读取本身不修改数据。',
  idempotency: null,
}))

add('study-statistics-teacher-course-list', base('study-statistics-teacher-course-list', {
  purpose: '查询某个讲师讲授过的课程明细分页（课程名、类型、所属班级、讲授时间）。',
  effect: 'read',
  inputs: {
    staffCode: optional('讲师工号。来自下钻路由的 [staffCode]。', 'study-statistics-teacher-list.list[].staffCode', '发送空字符串', { type: 'string | number' }),
    type: optional('课程类型（字典 `course_type`）；取值域未核实，只透传。', '页面对应下拉', '发送空字符串', { type: 'string | number' }),
    startTime: optional('讲授时间，YYYY-MM-DD HH:mm:ss。⚠️ 这一页是**单选**日期（页面 `a-date-picker`），不是区间，没有「结束日 +1 天」。', '页面的讲授时间选择器', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
    order: optional('排序方向。', '列表表头', '发送空字符串', { type: 'string', default: '空字符串' }),
    orderField: optional('排序字段。', '列表表头', '发送空字符串', { type: 'string', default: '空字符串' }),
    pageNo: optional('从 1 开始的页码。', '调用方分页状态', 'SDK 使用 1', { type: 'integer', default: '1' }),
    pageSize: optional('每页条数。', '调用方分页状态', 'SDK 使用 20', { type: 'integer', default: '20' }),
  },
  output: pageOutput(TEACHER_COURSE_FIELDS, '讲师讲授课程明细'),
  consume: [
    'courseName 是后端按 type 去远端资源补齐的：课程被删/远端取不到时该列可能为空，此时不能用它反推课程不存在。',
    'type 是课程类型原码，页面用字典 `course_type` 渲染标签；SDK 不给码到标签的映射。',
    '这一列只说明"讲授过"，不说明学员的学习情况；要看学习结果要用学员统计下钻。',
  ],
  steps: [],
  completion: '返回该讲师的课程明细分页；需要完整清单时继续翻页直到覆盖 total。',
  idempotency: null,
}))

add('study-statistics-teacher-lesson-list', base('study-statistics-teacher-lesson-list', {
  purpose: '查询某个讲师讲授过的班课明细分页，含评分人数、平均得分与 1~5 题各自的平均分。',
  effect: 'read',
  inputs: {
    staffCode: optional('讲师工号。来自下钻路由的 [staffCode]。', 'study-statistics-teacher-list.list[].staffCode', '发送空字符串', { type: 'string | number' }),
    title: optional('班课名称筛选。', '用户输入', '发送空字符串', { type: 'string', default: '空字符串' }),
    appraiseNumMin: optional('评分人数下限。', '用户输入', '发送空字符串', { type: 'number | string' }),
    appraiseNumMax: optional('评分人数上限。', '用户输入', '发送空字符串', { type: 'number | string' }),
    avgScoreMin: optional('平均得分下限。', '用户输入', '发送空字符串', { type: 'number | string' }),
    avgScoreMax: optional('平均得分上限。', '用户输入', '发送空字符串', { type: 'number | string' }),
    order: optional('排序方向。', '列表表头', '发送空字符串', { type: 'string', default: '空字符串' }),
    orderField: optional('排序字段。', '列表表头', '发送空字符串', { type: 'string', default: '空字符串' }),
    pageNo: optional('从 1 开始的页码。', '调用方分页状态', 'SDK 使用 1', { type: 'integer', default: '1' }),
    pageSize: optional('每页条数。', '调用方分页状态', 'SDK 使用 20', { type: 'integer', default: '20' }),
  },
  output: pageOutput(TEACHER_LESSON_FIELDS, '讲师讲授班课明细'),
  consume: [
    'oneAvgScore~fiveAvgScore 的**题号含义由评价设置决定**：先读 `study-appraise-setting-list` 的题目顺序再解释，不要假定第 1 题问的是什么。',
    'avgScore 与 1~5 题均分是同一批评分的不同口径；缺权重时不要用它们互相反推或再平均。',
    'appraiseNum 是评分人数，不是学员人数。',
  ],
  steps: [
    { role: 'optional', when: '需要解释 1~5 题分别问的是什么', capabilityId: 'study-appraise-setting-list', instruction: '按该能力返回的 sort 顺序对应 oneAvgScore~fiveAvgScore；题目数量可能少于 5，缺失的题号不要编造含义。' },
  ],
  completion: '返回该讲师的班课评分明细分页；需要完整清单时继续翻页直到覆盖 total。',
  idempotency: null,
}))

add('study-statistics-teacher-score-list', base('study-statistics-teacher-score-list', {
  purpose: '查询某个讲师收到的逐条评分明细（评分人、评分时间、评价总分与 1~5 题各自得分）。',
  effect: 'read',
  inputs: {
    staffCode: optional('讲师工号。来自下钻路由的 [staffCode]。', 'study-statistics-teacher-list.list[].staffCode', '发送空字符串', { type: 'string | number' }),
    allScoreMin: optional('评价总分下限。', '用户输入', '发送空字符串', { type: 'number | string' }),
    allScoreMax: optional('评价总分上限。', '用户输入', '发送空字符串', { type: 'number | string' }),
    startTimeFrom: optional('评分时间起，YYYY-MM-DD HH:mm:ss。用 `buildStudyStatisticsTeacherScoreTimeRange` 生成。', '用户选择的时间区间', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
    startTimeEnd: optional('评分时间止，**开区间**（结束日次日 00:00:00）。⚠️ 字段名是 `startTimeEnd`（不是 endTime），别照抄讲师统计页那个区间。', '用户选择的时间区间', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
    order: optional('排序方向。', '列表表头', '发送空字符串', { type: 'string', default: '空字符串' }),
    orderField: optional('排序字段。', '列表表头', '发送空字符串', { type: 'string', default: '空字符串' }),
    pageNo: optional('从 1 开始的页码。', '调用方分页状态', 'SDK 使用 1', { type: 'integer', default: '1' }),
    pageSize: optional('每页条数。', '调用方分页状态', 'SDK 使用 20', { type: 'integer', default: '20' }),
  },
  output: pageOutput(TEACHER_SCORE_FIELDS, '讲师得分明细'),
  consume: [
    '一行 = 一次评分（评分人 + 评分时间），不是一次班课；同一评分人对同一讲师可能有多行。',
    'oneScore~fiveScore 的题号含义与班课明细一致，由 `study-appraise-setting-list` 决定。',
    'sumScore 是后端算好的评价总分；缺少每题权重时不要用 1~5 题得分自行加总去核对它。',
  ],
  steps: [],
  completion: '返回该讲师的评分明细分页；需要完整清单时继续翻页直到覆盖 total。',
  idempotency: null,
}))

add('study-statistics-learning-action-details', base('study-statistics-learning-action-details', {
  purpose: '查询某个员工在某门智慧蛋鸡课程上的「学习」或「转发」行为的逐条明细。',
  effect: 'read',
  inputs: {
    lessonId: idParameter(
      '课程（章或节）id。**不是本地班课 id**，也**不是** `study-statistics-learning-summary` 里那个 lessonId 的同义改写 —— 两个接口用的都是智慧蛋鸡课程体系里的 id，但来源不同：这一条来自学习统计页课程级联选择器选中的末节点。',
      '学习统计页课程级联选择器（`smart-layer-app` 的 `/api/zhdj/studyLessonCatalogue/getChapterTree`）所选末节点 id',
    ),
    staffId: idParameter('员工 id（`hr_staff.id`）。**不是工号**、不是用户 id。', 'study-statistics-learning-summary 的 byStaff.list[].staffId'),
    actionType: parameter(
      '行为类型：1=学习（页面 `hasView` 列）、5=转发（页面 `hasForward` 列）。页面只在这两列的「是」上有入口，所以 SDK 也只收这两个值。',
      '用户在个人维度表上点的那一列',
      { type: 'integer', options: ACTION_DETAILS_TYPE_OPTIONS.map(item => ({ value: item.value, label: item.label })), constraints: ['后端支持 1~5，但本页只有 1 与 5 两个入口；传 2/3/4 会被 SDK 在发请求前拒绝。'] },
    ),
  },
  output: arrayOutput(ACTION_DETAIL_FIELDS, '该员工该行为的逐条明细'),
  consume: [
    '**返回是数组**（不是分页结构）：不要读 list/total，也不要用 pageNo 翻页。',
    'completed 是字符串且当前实现恒为「是」：它不表示"完成度"，不要当布尔值判断。',
    'completionTime 是行为时间：观看/评论/转发按课程范围过滤，点赞/收藏不过滤 —— 但本能力只开放 1（学习）与 5（转发），两条都受范围影响。',
    'courseName 里的「未知课程」「章节介绍」是后端回填的**占位文本**，不是真实课程名。',
  ],
  steps: [],
  completion: '返回该员工在该课程上该行为的全部记录；空数组表示没有这种行为的记录，不表示没有学习过（学习行为对应 actionType=1）。',
  idempotency: null,
}))

add('study-statistics-grade-lesson-record', base('study-statistics-grade-lesson-record', {
  purpose: '读取一组班课的课堂内容记录（班课名、环节记录、图片与附件）。',
  effect: 'read',
  inputs: {
    lessonIds: parameter(
      '班课 id 数组。传入后会被拼成**逗号分隔字符串**（后端 `lessonIds.split(",")`）发给接口。来自班级统计行的 `lessonIds`。',
      'study-statistics-grade-list.list[].lessonIds（**字符串**，逗号分隔；页面按原样传给弹窗）',
      { type: '(string | number)[]', constraints: ['非空数组；空数组或空串在本地就拒绝 —— 后端对空值直接返回空列表，静默的空会让人以为"这个班没有课堂内容"。'] },
    ),
  },
  output: arrayOutput(GRADE_RECORD_FIELDS, '班课课堂内容记录'),
  consume: [
    '**返回是数组**：每个元素是一个班课，不是分页结果。',
    '⚠️ 后端对 `lessonIds` 做的是 `sorted(Collections.reverseOrder())`（**字符串倒序**）后再逐个取，所以返回数组的**顺序与传入顺序不一致**：按 `lessonId` 逐条对应，不要按下标对齐。',
    'imgUrl / pdfUrl / pdfName 是**逗号分隔的多个值**：页面自己 split 后逐张/逐件展示，pdfName 与 pdfUrl 按下标一一对应。',
    'recordList[].recordType 是字典 `lesson_tag` 的值，页面用它取标签文本；取值域未核实，不要硬编码标签。',
  ],
  steps: [],
  completion: '返回这些班课的课堂内容记录（每个班课一项）；空数组表示这一组班课都没有记录。',
  idempotency: null,
}))

// 本文件是**增量**：五个列表页的契约在 contracts-business.ts，所以不能反过来要求
// definitions 里每条都在这里有契约（那是全量文件才成立的检查）。
// 能查的是另一个方向：这里声明的每个 id 都必须真有对应的能力定义（`add` 里已经逐条挡了一次）。
const extra = Object.keys(contracts).filter(id => !definitions.has(id))
if (extra.length > 0) {
  throw new Error(`Study statistics contract mapping mismatch: extra=${extra.join(',')}`)
}

export const STUDY_STATISTICS_AI_CONTRACTS: Record<string, AiContract> = contracts
