import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { ASSIGNMENT_RECORD_METHODS, assignmentRecordCapabilities } from '../capabilities/assignment.js'

/**
 * 「作业完成情况」页（`/dashboard/assignment/assignment/list` 的隐藏子路由
 * `record/[assignmentId]/item-list.vue`）两个能力的 AI 契约。
 *
 * 作业管理页面上那六个能力的契约在 `contracts-business.ts` 里（属权威目录，本文件不动它）。
 * 本文件按 `contracts-study-course.ts` 的自包含写法维护新增部分，**还没有接进
 * `src/catalog/ai-contracts.ts` / `contracts-business.ts`** —— 接线由派单方统一做。
 */

const definitions = new Map(assignmentRecordCapabilities.map(definition => [definition.id, definition]))

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

/**
 * ⚠️ 这一页的时间筛选有一处**前后端不一致**，两个契约都要写着同一个结论：
 *
 * 页面把日期区间转成 `createTimeStart` / `createTimeEnd`（`convertFetchForm`），
 * 而后端 `AssignmentPageSelectDTO` 上只有 `submitTimeStart` / `submitTimeEnd`
 * （SQL `getAllAssignment` 里判断的也是 `dto.submitTimeStart` / `dto.submitTimeEnd`）。
 * 名字对不上 ⇒ **这一对参数发出去服务端收不到，时间筛选实际不生效**。
 *
 * SDK 照页面原样发（D20：与浏览器逐字段一致），把差异如实写进说明而不是悄悄改名 ——
 * 改名等于 SDK 造了一个页面没有的筛选行为，也掩盖了页面的真实缺陷。
 */
const TIME_FILTER_WARNING = '⚠️ 这一对参数**服务端收不到**：页面发的是 createTimeStart/createTimeEnd，后端 DTO 只有 submitTimeStart/submitTimeEnd（SQL 判断的也是后者），所以按时间筛选在这两个接口上实际不生效。SDK 照页面原样发，不擅自改名。'

const commonParams: Record<string, AiParameter> = {
  assignmentId: idInput('作业要求 ID；来自作业管理列表行 list[].id（隐藏子路由的 assignmentId），不是提交记录 ID。', 'assignment-list 返回的 list[].id'),
  studentName: optional('学员姓名，模糊匹配。', '用户输入的学员姓名', '发送空字符串，不过滤', { type: 'string', default: '空字符串' }),
  staffCode: optional('学员工号（等值匹配），不是用户 ID。', '用户输入的学员工号', '发送空字符串，不过滤', { type: 'string | number' }),
  complete: optional('完成状态：0 未提交、1 已提交、2 晚交。', '页面"完成状态"下拉框（字典 assignment_record_complete_type）', '发送空字符串（后端绑成 null，不过滤）', {
    type: 'number | string',
    options: [{ value: 0, label: '未提交' }, { value: 1, label: '已提交' }, { value: 2, label: '晚交' }],
  }),
  gradeId: optional('所属班级 ID；先问用户关键字再用 study-grade-search 取候选。', '页面"所属班级"下拉框的候选 id', '发送空字符串（后端绑成 null，不过滤）', { type: 'string | number', lookup: { capabilityId: 'study-grade-search', args: { keyword: '<班级名称>' }, valueField: 'list[].id', labelField: 'list[].name' } }),
  lessonName: optional('班课名称，模糊匹配。', '用户输入的班课名称', '发送空字符串，不过滤', { type: 'string', default: '空字符串' }),
  createTimeStart: optional('提交时间起，YYYY-MM-DD HH:mm:ss；用 buildCreateTimeRange 生成。', '页面"提交时间"区间；建议用 buildCreateTimeRange', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
  createTimeEnd: optional('提交时间止（开区间，结束日次日 00:00:00）；用 buildCreateTimeRange 生成。', '页面"提交时间"区间；建议用 buildCreateTimeRange', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
}

/** 分页查询多两个参数；统计接口没有它们（那里的 inputs 只列 commonParams 的 8 个）。 */
const pageParams: Record<string, AiParameter> = {
  ...commonParams,
  pageNo: optional('从 1 开始的页码。', '调用方分页状态', 'SDK 使用 1', { type: 'integer', default: '1', constraints: ['正整数'] }),
  pageSize: optional('每页条数；Portal 列表模块默认 20。', '调用方分页状态', 'SDK 使用 20', { type: 'integer', default: '20', constraints: ['正整数'] }),
}

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:6ac274fc9e app/portal/views/dashboard/education/assignment/assignment/record/[assignmentId]/item-list.vue、app/portal/views/dashboard/education/study/study/components/assignment.vue',
    kind: 'reference',
    note: '核对两个请求的 URL、参数键序（assignmentStatic 没有 order/orderField/分页，assignmentPage 有）、时间区间的转换函数与"评分"弹窗的入口参数。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:77fbc2a206c StudyAssignmentSubmitRecordController#assignmentStatic/assignmentPage、StudyAssignmentSubmitRecordServiceImpl#getAssignmentStatic/getAssignmentPage、AssignmentPageSelectDTO、AssignmentStaticDTO、AssignmentPageDTO、StudyAssignmentSubmitRecordDao.xml#getAllAssignment',
    kind: 'reference',
    note: '核对返回字段与统计口径、assignmentPage 的逐条短链写入、时间参数名不一致、以及 complete 的 CASE 计算方式。',
  },
  {
    source: 'src/capabilities/assignment.ts',
    kind: 'implementation',
    note: '锁定 ASSIGNMENT_RECORD_METHODS、两套参数顺序（静态统计不带 order/分页）、assignmentId 校验与 buildCreateTimeRange 的用法。',
  },
  {
    source: 'test/assignment.test.ts',
    kind: 'test',
    note: '覆盖两套参数装配与顺序的差异、统计字段说明与"分页查询会写短链"这条关键语义；离线断言不替代真实测试环境读取。',
  },
]

const gaps: string[] = [
  '本轮未在真实测试环境调用这两个接口：参数形状与写入语义来自固定 Portal/Java 检出与离线测试，未取得真实响应体。',
  '短链表（hr_study_short_url）的累积速度只在源码上确认（每条记录一次 insert），没有真实环境的行数增长记录。',
  '字典 `assignment_record_complete_type` 的中文标签没有读到（0/1/2 的语义来自后端 DTO 注释与 assignmentStatic 的分类 switch）。',
]

const contracts: Record<string, AiContract> = {
  'assignment-static': {
    purpose: '查询某份作业在「作业完成情况」页顶部卡片的四个统计数（学员总数、已交、晚交、未交）与"是否需要讲师评分"。',
    whenToUse: '打开作业完成情况页、需要先看这份作业的整体完成情况时使用；只读，可以在筛选变化后重复调用。',
    boundaries: [
      '权限码为 /dashboard/assignment/assignment；页面上下文由 SDK 绑定，调用方不要另拼 module-type。',
      '**参数与 assignment-submit-record-page 不同名也不同套**：这里没有 `order`/`orderField`，也**没有 `pageNo`/`pageSize`** —— 它不是分页请求，四个数字是后端按整份名单算的，与表格当前页无关。',
      '`assignmentId` 是唯一的定位条件（页面里它来自隐藏路由参数，没有对应控件）；不传它后端会直接查不到作业。',
      TIME_FILTER_WARNING,
    ],
    effect: 'read',
    prerequisites: [
      '使用当前用户会话、租户与作业管理页面权限。',
      'assignmentId 来自 assignment-list 返回的 list[].id。',
    ],
    inputs: commonParams,
    output: {
      shape: 'object',
      fields: [
        field('$', 'object', '一次性的统计对象；非分页结构，不读取 list/total。'),
        field('assignmentName', 'string | null', '作业名称；页面显示在"作业名称"位置。', { nullable: true, nullMeaning: '后端未返回' }),
        field('totalNumber', 'number | null', '学员总数（这份作业的应完成人数）。', { nullable: true, nullMeaning: '后端未返回' }),
        field('submitNumber', 'number | null', '已交作业人数（不含晚交）。', { nullable: true, nullMeaning: '后端未返回' }),
        field('unSubmitNumber', 'number | null', '未交作业人数。', { nullable: true, nullMeaning: '后端未返回' }),
        field('lateSubmitNumber', 'number | null', '晚交作业人数。', { nullable: true, nullMeaning: '后端未返回' }),
        field('isTeacherCheck', 'number | null', '这份作业是否需要讲师评分：0 否、1 是；决定评分弹窗是"打分"还是"送花"。', { nullable: true, values: { '0': '不需要讲师评分', '1': '需要讲师评分' }, nullMeaning: '后端未返回' }),
      ],
      empty: '对象缺字段表示后端没返回该统计项；权限、网络或响应形状错误照常抛出，不降级为零值。',
    },
    consume: [
      '四个数字直接对应页面卡片；计算口径是"提交时间与截止时间的先后"（`create_time > end_time` 记晚交），不是"有没有评分"。',
      '`isTeacherCheck` 决定后续评分用 teacherScore 还是 teacherFlower，但**真正决定字段的是作业自身的 scoreType**（另一个接口），这里只作参考。',
      '统计与表格是两次独立请求：页面在点"查询"时同时刷新两者，SDK 不会替你合并它们。',
    ],
    steps: [
      { role: 'optional', when: '用户要看具体是哪些学员', capabilityId: 'assignment-submit-record-page', mapping: { assignmentId: 'args.assignmentId' }, instruction: '把同一组筛选条件一起带过去，统计与表格才会是同一个口径。' },
    ],
    completion: '返回这份作业的完成情况统计；读取不改变任何数据。',
    failures: [
      'assignmentId 缺失或非正整数时在发请求前抛错。',
      '权限、租户、网络或响应形状错误按原错误处理；不要用 0 填满缺失的统计项。',
    ],
    idempotency: null,
    evidence,
    gaps,
  },

  'assignment-submit-record-page': {
    purpose: '分页查询某份作业下每个学员的提交情况（提交时间、状态、自评、导师评分），并给出打开该学员答案的短链。',
    whenToUse: '在作业完成情况页看表格、"提交作业""自评说明""评分"三个行按钮都依赖它的返回时使用。**它不是只读接口**：每查一次都会为每条记录新签发短链。',
    boundaries: [
      '权限码为 /dashboard/assignment/assignment；页面上下文由 SDK 绑定。',
      '**名字叫 Page，实现里却在写**：后端对返回的**每一条**记录执行一次 `studyShortUrlDao.insert(...)`（`hr_study_short_url`），再把签名 URL 回写到 `fileUploadUrl`（`StudyAssignmentSubmitRecordServiceImpl:381-395`）。所以每翻一页/每重查一次都会留下 N 条新短链，`fileUploadUrl` 也每次不同。',
      '短链签发的条件只是"查到了这一行"，与操作者身份无关；调用方无法通过参数关掉它。',
      TIME_FILTER_WARNING,
      '`complete` 是后端用 CASE 算出来的（`create_time > end_time` 记 2 晚交、`< end_time` 记 1 已提交、其余记 0 未提交）；**恰好等于截止时间那一秒的提交会被算成"未提交"**，这是后端实现，SDK 如实透传不再加工。',
      '行里的 `id` 可能是空的：页面据此决定"评分"按钮是否渲染（没有提交记录就没有可评的对象）。',
    ],
    effect: 'write',
    prerequisites: [
      '使用当前用户会话、租户与作业管理页面权限。',
      'assignmentId 来自 assignment-list 返回的 list[].id（隐藏子路由的 assignmentId）。',
    ],
    inputs: pageParams,
    output: {
      shape: '{ list: object[], total: number }',
      fields: [
        field('list', 'object[]', '当前页学员提交记录；不是整份名单。'),
        field('total', 'number', '符合筛选条件的记录总数（含未提交的学员），不是当前页长度。'),
        field('list[].id', 'string | number | null', '提交记录 ID；**没有提交记录的学员这一项为 null**，页面因此不渲染"评分"按钮。', { nullable: true, nullMeaning: '这位学员还没有提交记录' }),
        field('list[].studentName', 'string | null', '学员姓名。', { nullable: true, nullMeaning: '后端未返回' }),
        field('list[].staffCode', 'string | number | null', '学员工号；评分弹窗用它查答案。', { nullable: true, nullMeaning: '后端未返回' }),
        field('list[].gradeId', 'string | number | null', '班级 ID。', { nullable: true, nullMeaning: '没有班级关系' }),
        field('list[].gradeName', 'string | null', '班级名称。', { nullable: true, nullMeaning: '没有班级关系' }),
        field('list[].lessonId', 'string | number | null', '班课 ID；评分时的 lessonId 用它。', { nullable: true, nullMeaning: '后端未返回' }),
        field('list[].lessonName', 'string | null', '班课名称。', { nullable: true, nullMeaning: '后端未返回' }),
        field('list[].linkId', 'string | number | null', '班课环节 ID；评分弹窗的 linkId 用它。', { nullable: true, nullMeaning: '后端未返回' }),
        field('list[].submitTime', 'string | null', '作业提交时间；未提交时为 null。', { nullable: true, nullMeaning: '这位学员没有提交' }),
        field('list[].complete', 'number | null', '提交状态：0 未提交、1 已提交、2 晚交。', { nullable: true, values: { '0': '未提交', '1': '已提交', '2': '晚交' }, nullMeaning: '后端未返回' }),
        field('list[].selfScore', 'number | null', '自评分。', { nullable: true, nullMeaning: '还没有自评' }),
        field('list[].selfScoreInfo', 'string | null', '自评说明；页面只在它（或自评分）有值时才渲染"自评说明"按钮。', { nullable: true, nullMeaning: '没有写自评说明' }),
        field('list[].teacherScore', 'number | null', '导师评分。', { nullable: true, nullMeaning: '还没有评分' }),
        field('list[].selfScoreTime', 'string | null', '自评时间。', { nullable: true, nullMeaning: '还没有自评' }),
        field('list[].fileUploadUrl', 'string | null', '**本次查询新签发的**答案上传短链；页面的"提交作业"按钮就是打开它。它不是作业的固定地址，两次查询的值不同。', { nullable: true, nullMeaning: '后端没有为这一行签发短链' }),
      ],
      empty: 'list=[] 且 total=0 表示这份作业在当前筛选下没有可见学员；空列表不等于"没人交作业"，也可能是筛选条件本身不生效（见时间参数说明）。',
    },
    consume: [
      '行按钮的三个前置条件都在这一行上：`id` 有值才渲染"评分"、`selfScoreInfo || selfScore` 有值才渲染"自评说明"、`fileUploadUrl` 是"提交作业"要打开的地址。',
      '评分时把 `linkId`、`lessonId`、`staffCode`、`studentName`、`gradeName`、`lessonName` 一起交给评分弹窗（页面就是这么传的）；`resourceId` 用的是路由上的 assignmentId，不是行里的字段。',
      '`complete` 用字典 `assignment_record_complete_type` 显示标签；不要自己按 submitTime 是否有值重新推断状态。',
      '**不要轮询、不要为了"刷新一下"反复调用**：每一次调用都会新增 N 条短链记录。需要重查时先确认用户意图。',
    ],
    steps: [
      { role: 'required', when: '用户点"评分"并提交评分', capabilityId: 'study-record-assignment-get', mapping: { linkId: 'result.list[].linkId', staffCode: 'result.list[].staffCode' }, instruction: '评分弹窗先读答案（linkId + staffCode），再经 assignment-check-permission 预检后才提交；不要直接跳到提交。' },
      { role: 'optional', when: '用户点"提交作业"打开答案', capabilityId: 'assignment-static', mapping: { assignmentId: 'args.assignmentId' }, instruction: 'fileUploadUrl 是本次查询签发的地址，直接用；不要在两次查询之间缓存它。' },
    ],
    completion: '返回当前页学员提交情况与新签发的短链；除短链表新增行外不改变业务数据。',
    failures: [
      'assignmentId 缺失或非正整数时在发请求前抛错。',
      '权限、租户、网络或响应形状错误按原错误处理；超时后重试会再签发一批短链，所以超时先确认上一次是否已经返回（例如先看列表条数），不要无脑重放。',
    ],
    idempotency: '端点没有 requestId，且**每次调用都新增短链行**：重复调用不会改坏业务数据，但会持续留下短链记录、且 fileUploadUrl 每次都变。超时后可以安全重试，只要接受多一批短链。',
    evidence,
    gaps: [
      ...gaps,
      '短链的用途（谁在什么页面用它上传答案、有效期多长）没有在本次核对里确认，SDK 只保证把它原样交给调用方。',
    ],
  },
}

const methodIds = Object.keys(ASSIGNMENT_RECORD_METHODS)
const mismatch = methodIds.filter(id => !contracts[id]).concat(Object.keys(contracts).filter(id => !methodIds.includes(id)))
if (mismatch.length > 0) throw new Error(`assignment 完成情况契约映射不一致：${mismatch.join(',')}`)
for (const id of methodIds) {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`assignment 完成情况契约没有能力定义：${id}`)
  const missingInput = definition.params.filter(param => contracts[id]!.inputs[param.name] === undefined)
  if (missingInput.length > 0) throw new Error(`${id} 的契约缺少参数说明：${missingInput.map(p => p.name).join(',')}`)
}

export const ASSIGNMENT_RECORD_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  methodIds.map(id => [id, contracts[id]!]),
)

export const ASSIGNMENT_RECORD_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(ASSIGNMENT_RECORD_METHODS).map(([capabilityId, method]) => [
    `assignment.${method}`,
    {
      ...contracts[capabilityId]!,
      boundaries: [
        ...contracts[capabilityId]!.boundaries,
        `这是公开门面 sdk.assignment.${method}；参数按本契约 inputs 传入，不要与作业管理页那六个能力的参数混用。`,
      ],
    },
  ]),
)
