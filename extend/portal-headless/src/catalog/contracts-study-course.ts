import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { STUDY_COURSE_METHODS, studyCourseCapabilities } from '../capabilities/study-course.js'

/**
 * AI contracts for the IM-course capabilities.
 *
 * The three visible course lists already have contracts in contracts-business.ts.
 * This file is intentionally self-contained so the hidden routes/actions can be
 * reviewed and wired into the authoritative catalog as one unit by the main line.
 */

const definitions = new Map(studyCourseCapabilities.map(definition => [definition.id, definition]))

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
  constraints: ['安全正整数或无前导零的正整数字符串；长ID保留字符串，不用名称或行号代替。'],
})

const pageOutput = (rowFields: AiField[], label: string): AiContract['output'] => ({
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', `${label}分页结果。`),
    field('list', 'object[]', '当前页记录，不是全部记录。'),
    field('list[]', 'object', '一条页面或后端返回记录。'),
    ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` })),
    field('total', 'number', '符合筛选条件的总记录数，不是当前页长度。'),
  ],
  empty: 'list=[]表示当前页为空；total=0才表示当前筛选没有记录。权限、会话、网络或响应形状错误会抛出，不降级为空页。',
})

const draftOutput = (label: string, fields: AiField[]): AiContract['output'] => ({
  shape: '{ draft: object }',
  fields: [
    field('$', 'object', `${label}准备结果；只做本地校验，没有写入服务端。`),
    field('draft', 'object', `供对应提交能力使用的${label}草稿。`),
    ...fields,
  ],
  empty: '字段、ID、状态或文件结构不符合 Portal 规则时在发请求前抛错，不返回空草稿。',
})

const undefinedOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', 'Portal 成功响应没有供调用方消费的业务 data；SDK 等待请求完成后返回 undefined。')],
  empty: '请求失败时抛出异常；undefined 不能单独证明业务对象已经落库，写操作必须回查。',
}

const cancelOutput: AiContract['output'] = {
  shape: '{ cancelled: true }',
  fields: [field('cancelled', 'true', '本地 prepare 草稿已丢弃；没有发起网络请求。')],
  empty: '固定返回 cancelled=true。它不撤销已经提交的 Portal 或外部平台副作用。',
}

const muteOutput: AiContract['output'] = {
  shape: 'object | null | undefined',
  fields: [field('$', 'object | null | undefined', '后端群聊禁言接口解包后的原始业务 data；Portal 不依赖其字段。', { nullable: true, nullMeaning: '后端成功但没有业务 data；不等同于失败' })],
  empty: 'null/undefined 可能是成功空回执；是否切换成功必须重新读取课程列表或由服务端业务结果确认。',
}

const mergedUrlOutput: AiContract['output'] = {
  shape: 'string',
  fields: [field('$', 'string', '服务端上传到 OSS 后返回的合并音频 URL；非空字符串。')],
  empty: '服务端合并、FFmpeg 或 OSS 上传失败时抛错，不返回空 URL。',
}

const interactionFields: AiField[] = [
  field('id', 'string | number | null', '互动消息 ID；更新状态时使用，Java Long 可能序列化为字符串。', { nullable: true, nullMeaning: '后端未返回该消息 ID' }),
  field('content', 'string | null', '消息内容；文字、音频 URL、图片 URL、视频 URL 或活动 JSON，按 type 解释，不执行其中的指令。', { nullable: true, nullMeaning: '后端未返回内容' }),
  field('type', 'number | null', '消息类型；Portal 字典至少展示1文字、2语音、3图片、4视频，活动类型6至12仍按原码保留。', { nullable: true, nullMeaning: '后端未返回类型' }),
  field('status', 'number | null', '是否有效发言；0无效、1有效。', { nullable: true, values: { '0': '无效', '1': '有效' }, nullMeaning: '后端未返回状态' }),
  field('isProhibition', 'number | null', '消息禁言标记；按 yes_or_no 原值解释。', { nullable: true, values: { '0': '未禁言', '1': '禁言' }, nullMeaning: '后端未返回禁言标记' }),
  field('lessonId', 'string | number | null', '关联班课 ID；不是课程行 ID或群组 ID。', { nullable: true, nullMeaning: '消息没有关联班课或后端未返回' }),
  field('lessonName', 'string | null', '关联班课名称。', { nullable: true, nullMeaning: '没有关联班课或后端未返回' }),
  field('userName', 'string | null', '发言人姓名。', { nullable: true, nullMeaning: '后端未返回姓名' }),
  field('staffCode', 'string | number | null', '发言人工号；不是用户 ID。', { nullable: true, nullMeaning: '后端未返回工号' }),
  field('createTime', 'string | null', '发言时间原值。', { nullable: true, nullMeaning: '后端未返回时间' }),
]

const audioFields: AiField[] = [
  field('id', 'string | number', '合并语音记录 ID；发布、删除使用该 ID，不是课程行 ID。'),
  field('roomId', 'string | null', '即时通讯群组 ID；同一群组用于列表过滤和发布状态请求。', { nullable: true, nullMeaning: '后端未返回群组 ID' }),
  field('lessonId', 'string | number | null', '关联班课 ID；发布状态请求有值时追加该字段。', { nullable: true, nullMeaning: '没有关联班课或后端未返回' }),
  field('lessonName', 'string | null', '关联班课名称。', { nullable: true, nullMeaning: '后端未返回班课名称' }),
  field('url', 'string | null', '合并音频 URL；页面播放和下载使用，不能当作提交给 audioMerge 的 fileList。', { nullable: true, nullMeaning: '后端未返回 URL' }),
  field('status', 'number | null', '发布状态；0未发布、1已发布。', { nullable: true, values: { '0': '未发布', '1': '已发布' }, nullMeaning: '后端未返回状态' }),
  field('isDel', 'number | null', '软删除标记；0未删除、1已删除。', { nullable: true, values: { '0': '未删除', '1': '已删除' }, nullMeaning: '后端未返回标记' }),
  field('duration', 'string | number | null', '音频时长原值；Portal 页面计算或展示，不由 SDK 换算单位。', { nullable: true, nullMeaning: '后端未返回时长' }),
  field('mergeTime', 'string | null', '合成时间原值。', { nullable: true, nullMeaning: '后端未返回合成时间' }),
  field('createTime', 'string | null', '记录创建/发布时间原值。', { nullable: true, nullMeaning: '后端未返回创建时间' }),
  field('isAutoMerge', 'number | null', '是否自动合并原码；页面不以此替代发布状态。', { nullable: true, nullMeaning: '后端未返回' }),
  field('creator', 'string | number | null', '创建人用户 ID；页面不以它替代当前群主/课程创建人权限。', { nullable: true, nullMeaning: '后端未返回' }),
  field('updater', 'string | number | null', '最后修改人用户 ID。', { nullable: true, nullMeaning: '后端未返回' }),
  field('updateTime', 'string | null', '最后修改时间原值。', { nullable: true, nullMeaning: '后端未返回' }),
  field('linkId', 'string | number | null', '关联环节 ID；页面不使用时仍保留原值。', { nullable: true, nullMeaning: '后端未返回' }),
]

const commonEvidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:acab69acc77b app/portal/menus/hr.js、app/portal/views/dashboard/education/course/im-course/list.vue、im-course/[mode]/[id].vue、im-course/message/[id]/[roomId]/item-list.vue、im-course/merge/[roomId]/item-list.vue、im-course/components/voice-merge.vue、im-course/components/voice-merge-status.vue',
    kind: 'reference',
    note: '逐页核对即时通讯课程菜单权限、隐藏路由可达性、表单字段/默认值、列表筛选键序、行操作可见条件、消息状态请求、合并语音发布/删除和语音合并请求；当前固定检出源码证据，未把注释掉的解散按钮当作能力。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:0f1a55718eb StudyCourseController、StudyInteractionController、StudyAudioMergeController、AudioMergeController、AddCourseDTO、LiveMsgDTO、StudyAudioMergeDTO、MergeDTO、StudyCourseServiceImpl、StudyInteractionServiceImpl、StudyAudioMergeServiceImpl',
    kind: 'reference',
    note: '核对课程创建/群聊禁言、互动状态、音频分页/发布/删除、FFmpeg+OSS合并端点的HTTP方法、请求字段、返回语义与外部副作用；固定检出静态证据，不代表该提交已经部署到测试环境。',
  },
  {
    source: 'src/capabilities/study-course.ts',
    kind: 'implementation',
    note: '锁定 SDK 的能力 ID、方法映射、参数校验、固定 type/sessionType/joinmode/msg、FormData 键序、原始请求体和本地 cancel 语义。',
  },
  {
    source: 'baseline/study-course.browser.json',
    kind: 'browser',
    note: '历史脱敏浏览器基准证明课程列表和隐藏消息/语音查询的请求形状；本契约没有把它扩大为本轮真实写操作验证。',
  },
]

const commonGaps = [
  '尚未在真实测试环境逐条执行该隐藏 IM 动作的 prepare→submit→独立回查→清理闭环；浏览器基准是历史脱敏证据，不替代本轮写验证。',
  '当前浏览器自动化会被登录页拦截，不能据此声称本轮线上权限或写入结果已验证；Portal/Java 结论来自固定检出源码和离线 SDK 实现。',
]

type ContractBody = Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>

const base = (value: ContractBody): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「学习管理 → 课程管理 → 即时通讯课程」列表及其由列表行实际进入的隐藏新建、互动消息和合并语音页面。',
  boundaries: [
    '菜单权限和隐藏路由权限均为 /dashboard/course/im-course；隐藏消息页、合并语音页和新建表单没有独立菜单权限，均由即时通讯课程列表实际路由进入。',
    '页面上下文推导 module-type=12（学习管理）；SDK 统一客户端负责会话 token、tenant-id、module-type 和用户隔离，调用方不要手工拼接或跨租户复用 ID。',
    '课程行的查看消息、查看合并语音、禁言/解禁按钮只在 record.creator 等于当前登录 userId 时渲染；这是 Portal 的可见性规则，不替代服务端鉴权，权限失败不能改写成空列表或成功。',
    '课程行 ID、远端群组 roomId、互动消息 ID、合并语音记录 ID 和班课 lessonId 是不同主键；它们只能按各自字段传递，不能用名称、索引或另一类 ID 替换。',
    'type=4、sessionType=2、创建草稿 type=4、imGroupDTO.joinmode=0、imGroupDTO.msg=“即时通讯课程”均由 Portal 固定；SDK 不开放调用方改写这些页面常量。',
    '本文件只覆盖 Portal 当前菜单可达的 IM 课程动作；直播课程 type=3 和 Portal 中已注释的解散按钮不属于本组能力。',
    'prepare/cancel 是本地草稿流程；提交后新建、消息状态、音频发布/删除和语音合并的跨系统或数据库副作用没有通用回滚接口，cancel 不能被解释为撤销已提交动作。',
  ],
  prerequisites: [
    '使用当前用户会话、租户和即时通讯课程页面上下文创建 SDK；所有写入目标均来自当前租户最新列表或当前隐藏路由。',
    '需要创建课程时先取得用户确认的 gradeId、课程名称和群主 staffCode；staffCode 是页面群主候选的工号，不是用户 ID。',
  ],
  failures: [
    '非法 ID、空标题、标题超过100字节、状态不在0/1、空或少于两个音频地址、缺少必填字段会在发请求前抛错。',
    '401/403、租户/数据范围、网络、服务端业务错误或响应形状错误原样抛出；不能用空数组、undefined、null或HTTP成功代替业务成功。',
    '跨系统依赖失败可能已经产生部分副作用：创建可能已经建立远端群组，消息状态可能已经调用外部消息平台，合并语音可能已经上传临时文件/OSS对象；失败后先回查，不要盲目重试。',
  ],
  evidence: commonEvidence,
  gaps: commonGaps,
})

const contracts: Record<string, AiContract> = {}

function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Study course contract has no capability definition: ${id}`)
  contracts[id] = value
}

const textVideoListInputs: Record<string, AiParameter> = {
  keyword: optional('远端图文/视频资源名称关键字；命中资源时当前后端历史上可能因全量用户映射超过500条而报错。', '用户明确提供的资源名称片段', '按 Portal 发送空字符串，不限制关键字', { type: 'string', default: '空字符串' }),
  startTime: optional('创建时间起，YYYY-MM-DD HH:mm:ss。', '用户选择的日期区间；建议用 buildStudyCourseTimeRange', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
  endTime: optional('创建时间止；Portal 以结束日次日00:00:00发送开区间边界。', '用户选择的日期区间；建议用 buildStudyCourseTimeRange', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
  pageNo: optional('从1开始的页码。', '调用方分页状态', 'SDK使用1', { type: 'integer', default: '1', constraints: ['正整数'] }),
  pageSize: optional('每页条数。', '调用方分页状态', 'SDK使用20', { type: 'integer', default: '20', constraints: ['正整数'] }),
}

const imListInputs: Record<string, AiParameter> = {
  keyword: optional('课程名称关键字；命中资源时可能触发后端全量用户映射500条上限。', '用户明确提供的课程名称片段', '发送空字符串', { type: 'string', default: '空字符串' }),
  numberMin: optional('群组人数下限。', 'Portal 群组人数最小值输入框', '发送空字符串', { type: 'number | string' }),
  numberMax: optional('群组人数上限。', 'Portal 群组人数最大值输入框', '发送空字符串', { type: 'number | string' }),
  status: optional('课程状态字典 im_course_status；0使用、1解散。', 'Portal 课程状态下拉框', '发送空字符串', { type: 'number | string', options: [{ value: 0, label: '使用' }, { value: 1, label: '解散' }] }),
  createTimeStart: optional('创建时间起，YYYY-MM-DD HH:mm:ss。', 'Portal 创建时间范围；建议用 buildStudyCourseCreateTimeRange', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
  createTimeEnd: optional('创建时间止；Portal 以结束日次日00:00:00发送。', 'Portal 创建时间范围；建议用 buildStudyCourseCreateTimeRange', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
  deleteTimeStart: optional('解散时间起，YYYY-MM-DD HH:mm:ss。', 'Portal 解散时间范围；建议用 buildStudyCourseDeleteTimeRange', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
  deleteTimeEnd: optional('解散时间止；Portal 以结束日次日00:00:00发送。', 'Portal 解散时间范围；建议用 buildStudyCourseDeleteTimeRange', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
  pageNo: optional('从1开始的页码。', '调用方分页状态', 'SDK使用1', { type: 'integer', default: '1', constraints: ['正整数'] }),
  pageSize: optional('每页条数。', '调用方分页状态', 'SDK使用20', { type: 'integer', default: '20', constraints: ['正整数'] }),
}

const interactionInputs: Record<string, AiParameter> = {
  id: idInput('课程行 ID；来自即时通讯课程列表，用于隐藏消息页的路由查询。', 'study-course-im-list.list[].id'),
  roomId: parameter('即时通讯群组 ID；来自 study-course-im-list.list[].imGroupDTO.groupId 或隐藏消息路由。', 'study-course-im-list.list[].imGroupDTO.groupId 或当前路由 roomId', { type: 'string | number' }),
  order: optional('排序方向；语音选择弹窗传 asc，消息列表页默认空串。', 'Portal 列表模块', '发送空字符串', { type: 'string', default: '空字符串' }),
  orderField: optional('排序字段；语音选择弹窗传 createTime，消息列表页默认空串。', 'Portal 列表模块', '发送空字符串', { type: 'string', default: '空字符串' }),
  content: optional('消息内容筛选。', '消息页内容输入框', '发送空字符串', { type: 'string', default: '空字符串' }),
  type: optional('消息类型；语音选择弹窗固定传2。', '消息页/语音选择弹窗', '发送空字符串', { type: 'number | string' }),
  status: optional('互动消息有效状态；0无效、1有效。', '消息页状态字典', '发送空字符串', { type: 'number | string', options: [{ value: 0, label: '无效' }, { value: 1, label: '有效' }] }),
  name: optional('发言人姓名筛选。', '消息页姓名输入框或语音选择弹窗', '发送空字符串', { type: 'string', default: '空字符串' }),
  staffCode: optional('发言人工号筛选，不是用户 ID。', '消息页工号输入框', '发送空字符串', { type: 'string | number' }),
  isProhibition: optional('消息禁言标记筛选；按 yes_or_no 原值传递。', '消息页禁言状态字典', '发送空字符串', { type: 'number | string' }),
  createTimeStart: optional('发言时间起；结束日期转换由 Portal 处理为次日00:00:00。', '消息页日期范围', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
  createTimeEnd: optional('发言时间止的开区间边界。', '消息页日期范围', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
  pageNo: optional('从1开始的页码。', '调用方分页状态', 'SDK使用1', { type: 'integer', default: '1' }),
  pageSize: optional('每页条数。', '调用方分页状态', 'SDK使用20', { type: 'integer', default: '20' }),
}

const audioListInputs: Record<string, AiParameter> = {
  roomId: parameter('即时通讯群组 ID；来自当前隐藏合并语音路由。', 'study-course-im-list.list[].imGroupDTO.groupId 或路由 roomId', { type: 'string | number' }),
  order: optional('排序方向；合并语音页默认空串。', 'Portal 列表模块', '发送空字符串', { type: 'string', default: '空字符串' }),
  orderField: optional('排序字段；合并语音页默认空串。', 'Portal 列表模块', '发送空字符串', { type: 'string', default: '空字符串' }),
  pageNo: optional('从1开始的页码。', '调用方分页状态', 'SDK使用1', { type: 'integer', default: '1' }),
  pageSize: optional('每页条数。', '调用方分页状态', 'SDK使用20', { type: 'integer', default: '20' }),
}

add('study-course-text-list', base({
  purpose: '按 Portal 图文课程列表筛选条件查询 type=1 的图文课程分页。',
  effect: 'read',
  inputs: textVideoListInputs,
  output: pageOutput([
    field('id', 'string | number', '课程记录 ID；不是远端图文资源 ID。'),
    field('creator', 'string | number | null', '课程创建者用户 ID；页面行操作可见性比较使用。', { nullable: true, nullMeaning: '后端未返回创建者' }),
    field('creatorName', 'string | null', '录入/创建人姓名。', { nullable: true, nullMeaning: '后端未返回' }),
    field('news', 'object | null', '远端图文资源；null时课程行仍存在但资源不可用。', { nullable: true, nullMeaning: '资源不可用或后端未返回' }),
    field('news.id', 'string | number | null', '远端图文资源 ID；不是课程记录 ID。', { nullable: true, nullMeaning: '没有资源' }),
    field('news.title', 'string | null', '图文标题。', { nullable: true, nullMeaning: '没有资源或标题' }),
    field('news.voiceState', 'number | null', '语音状态；0成功、1失败、2生成中。', { nullable: true, values: { '0': '成功', '1': '失败', '2': '生成中' }, nullMeaning: '没有资源' }),
  ], '图文课程'),
  consume: ['保留课程记录ID和news.id的区别；资源为空时保留课程行并标记资源不可用。', '需要完整结果时按同一筛选递增pageNo直到total覆盖。'],
  steps: [],
  completion: '返回当前筛选的图文课程页；读取本身不修改数据。',
  idempotency: null,
}))

add('study-course-video-list', base({
  purpose: '按 Portal 视频课程列表筛选条件查询 type=2 的视频课程分页。',
  effect: 'read',
  inputs: textVideoListInputs,
  output: pageOutput([
    field('id', 'string | number', '课程记录 ID；不是远端视频资源 ID。'),
    field('creator', 'string | number | null', '课程创建者用户 ID。', { nullable: true, nullMeaning: '后端未返回创建者' }),
    field('creatorName', 'string | null', '录入/创建人姓名。', { nullable: true, nullMeaning: '后端未返回' }),
    field('videos', 'object | null', '远端视频资源；null时课程行仍存在但资源不可用。', { nullable: true, nullMeaning: '资源不可用或后端未返回' }),
    field('videos.id', 'string | number | null', '远端视频资源 ID；不是课程记录 ID。', { nullable: true, nullMeaning: '没有资源' }),
    field('videos.title', 'string | null', '视频标题。', { nullable: true, nullMeaning: '没有资源或标题' }),
    field('videos.duration', 'number | string | null', '视频时长；Portal 明确按秒展示。', { nullable: true, unit: '秒', nullMeaning: '没有资源或时长' }),
  ], '视频课程'),
  consume: ['保留课程记录ID和videos.id的区别；资源为空时不能判定课程未创建。', '需要完整结果时按同一筛选递增pageNo直到total覆盖。'],
  steps: [],
  completion: '返回当前筛选的视频课程页；读取本身不修改数据。',
  idempotency: null,
}))

add('study-course-im-list', base({
  purpose: '按 Portal 即时通讯课程列表筛选条件查询固定 type=4 的课程分页，并取得隐藏消息/合并语音入口所需的课程行和群组 ID。',
  effect: 'read',
  inputs: imListInputs,
  output: pageOutput([
    field('id', 'string | number', '课程记录 ID；隐藏消息路由使用它，不是远端群组 ID。'),
    field('creator', 'string | number | null', '课程创建者用户 ID；Portal 仅当它等于当前 userId 时显示行操作。', { nullable: true, nullMeaning: '后端未返回创建者' }),
    field('creatorName', 'string | null', '录入/创建人姓名。', { nullable: true, nullMeaning: '后端未返回' }),
    field('isDel', 'number | null', '课程状态；Portal 读取外层 record.isDel，0使用、1解散。', { nullable: true, values: { '0': '使用', '1': '解散' }, nullMeaning: '后端未返回' }),
    field('imGroupDTO', 'object | null', '远端即时通讯群组资源。', { nullable: true, nullMeaning: '远端资源不可用或后端未返回' }),
    field('imGroupDTO.title', 'string | null', '课程名称。', { nullable: true, nullMeaning: '没有群组资源' }),
    field('imGroupDTO.number', 'number | null', '群组人数。', { nullable: true, nullMeaning: '没有群组资源' }),
    field('imGroupDTO.ownerName', 'string | null', '群主姓名；Portal 与 staffCode 拼接展示。', { nullable: true, nullMeaning: '没有群组资源' }),
    field('imGroupDTO.staffCode', 'string | null', '群主工号；不是用户 ID。', { nullable: true, nullMeaning: '没有群组资源' }),
    field('imGroupDTO.groupId', 'string | number | null', '远端群组 ID；隐藏消息/合并语音路由使用。', { nullable: true, nullMeaning: '没有群组资源' }),
    field('imGroupDTO.chatRoomMuted', 'boolean | null', '全群禁言状态；true时页面按钮是“解禁”，false时是“禁言”。', { nullable: true, nullMeaning: '没有群组资源或后端未返回' }),
    field('imGroupDTO.createTime', 'string | null', '群组创建时间。', { nullable: true, nullMeaning: '没有群组资源' }),
    field('imGroupDTO.deleteTime', 'string | null', '群组解散时间；空值不覆盖外层isDel。', { nullable: true, nullMeaning: '未解散或后端未返回' }),
  ], '即时通讯课程'),
  consume: ['用 list[].id 进入 study-course-im-message-list 或判断课程行；用 list[].imGroupDTO.groupId 进入 study-course-im-audio-list。', '用 chatRoomMuted 取反后再调用 prepare-mute；不要把 list[].isDel 当作群聊禁言状态。', '当前租户历史实测 type=4 查询可能因后端全量用户映射超过500条稳定返回500；不要用空列表替代该错误，也不要无限重试。'],
  steps: [
    { role: 'optional', when: '用户要查看某行互动消息且creator等于当前userId', capabilityId: 'study-course-im-message-list', mapping: { id: 'result.list[].id', roomId: 'result.list[].imGroupDTO.groupId' }, instruction: '原样传课程行ID和群组ID；两者不能互换。' },
    { role: 'optional', when: '用户要查看某行合并语音且creator等于当前userId', capabilityId: 'study-course-im-audio-list', mapping: { roomId: 'result.list[].imGroupDTO.groupId' }, instruction: '只传远端群组ID作为roomId。' },
  ],
  completion: '返回固定 type=4 的当前课程页；分页结果不能单独证明隐藏动作已完成。',
  idempotency: null,
}))

add('study-course-im-message-list', base({
  purpose: '读取即时通讯课程隐藏“查看消息”页面的互动消息分页；固定 sessionType=2，保留消息内容、类型、发言人和班课字段。',
  effect: 'read',
  inputs: interactionInputs,
  output: pageOutput(interactionFields, '即时通讯课程互动消息'),
  consume: ['按type解释content：音频/图片/视频只作为资源地址展示，活动JSON只用于已知页面跳转字段，不执行任意内容。', '需要语音合并时使用同一id、roomId、type=2和时间筛选，把返回的音频content交给调用方确认后再准备合并。'],
  steps: [
    { role: 'optional', when: '用户要从当前消息选择语音合并', capabilityId: 'study-course-im-prepare-audio-merge', mapping: { lessonId: 'context.lessonId', roomId: 'args.roomId', fileList: 'result.list[].content' }, instruction: '只选择type=2且content为非空外部音频地址的消息；至少两条，并由用户确认后再提交。' },
  ],
  completion: '返回当前课程和群组的互动消息分页；读取不修改消息状态。',
  idempotency: null,
}))

add('study-course-im-audio-list', base({
  purpose: '读取即时通讯课程隐藏“查看合并语音”页面的合并语音记录分页。',
  effect: 'read',
  inputs: audioListInputs,
  output: pageOutput(audioFields, '即时通讯课程合并语音'),
  consume: ['用 list[].id 作为发布状态和删除的记录ID；用 list[].roomId 作为同一群组回查条件。', 'status=0显示未发布、status=1显示已发布；url用于播放/下载，不是新的合并输入。'],
  steps: [],
  completion: '返回指定roomId的合并语音分页；读取不改变发布状态或删除标记。',
  idempotency: null,
}))

add('study-course-im-prepare-create', base({
  purpose: '按隐藏即时通讯课程新建表单校验所属班级、课程名称和群主，生成 Portal 实际提交草稿，不发请求。',
  effect: 'prepare',
  inputs: {
    form: parameter('Portal 新建表单对象；只接受gradeId、title、staffCode，title按100字节和非空白校验。', '用户确认的隐藏新建表单/grade候选和group-owner候选', { type: 'object' }),
    'form.gradeId': idInput('所属班级 ID；不可使用班级名称。', 'Portal grade-select 候选 id'),
    'form.title': parameter('课程名称；非空、非纯空白、UTF-8不超过100字节。', '用户明确输入', { type: 'string', constraints: ['非空白', 'UTF-8最多100字节'] }),
    'form.staffCode': parameter('群主工号；来自群主选择器的staffCode，不是用户 ID。', 'Portal group-owner-select.value-key=staffCode', { type: 'string | number' }),
  },
  output: draftOutput('即时通讯课程新建', [
    field('draft.type', '4', 'Portal 固定课程类型。', { values: { '4': '即时通讯群组课程' } }),
    field('draft.gradeId', 'string | number', '所属班级 ID。'),
    field('draft.imGroupDTO', 'object', 'Portal 固定的远端群组课程对象。'),
    field('draft.imGroupDTO.joinmode', '0', 'Portal 固定加入模式。', { values: { '0': '固定页面值' } }),
    field('draft.imGroupDTO.msg', '即时通讯课程', 'Portal 固定资源消息类型文字。'),
    field('draft.imGroupDTO.title', 'string', '课程名称。'),
    field('draft.imGroupDTO.staffCode', 'string | number', '群主工号。'),
  ]),
  consume: ['向用户展示gradeId、title、staffCode和固定type/joinmode/msg；prepare成功不代表远端群组已创建。'],
  steps: [
    { role: 'required', when: '用户确认创建且草稿仍有效', capabilityId: 'study-course-im-create', mapping: { draft: 'result.draft' }, instruction: '只把prepare返回的完整draft原样提交；不要自行增加或删除imGroupDTO字段。' },
    { role: 'cancel', when: '用户取消新建或修改表单', capabilityId: 'study-course-im-cancel-create', instruction: '丢弃本地draft，不调用Portal。' },
  ],
  completion: '得到通过Portal表单规则的本地创建草稿；业务记录尚未写入。',
  idempotency: null,
}))

add('study-course-im-create', base({
  purpose: '提交已准备的即时通讯课程新建草稿；对应隐藏表单 POST /study/course/studycourse。',
  effect: 'write',
  inputs: {
    draft: parameter('study-course-im-prepare-create 返回的完整draft；必须保留type=4、gradeId和完整imGroupDTO。', 'study-course-im-prepare-create.draft', { type: 'object' }),
    'draft.type': parameter('固定课程类型4。', 'prepare-create.draft.type', { type: '4', options: [{ value: 4, label: '即时通讯群组课程' }] }),
    'draft.gradeId': idInput('所属班级 ID。', 'prepare-create.draft.gradeId'),
    'draft.imGroupDTO.joinmode': parameter('固定0。', 'prepare-create.draft.imGroupDTO.joinmode', { type: '0' }),
    'draft.imGroupDTO.msg': parameter('固定“即时通讯课程”。', 'prepare-create.draft.imGroupDTO.msg', { type: 'string' }),
    'draft.imGroupDTO.title': parameter('课程名称。', 'prepare-create.draft.imGroupDTO.title', { type: 'string' }),
    'draft.imGroupDTO.staffCode': parameter('群主工号。', 'prepare-create.draft.imGroupDTO.staffCode', { type: 'string | number' }),
  },
  output: undefinedOutput,
  consume: ['请求体是{type:4,gradeId,imGroupDTO:{joinmode:0,msg:“即时通讯课程”,title,staffCode}}；SDK返回undefined，不会伪造新课程ID。', '成功或超时后重新查询 study-course-im-list，并按title、gradeId/群组信息核对新增行；不能只看HTTP成功。'],
  steps: [
    { role: 'required', when: '请求成功或超时', capabilityId: 'study-course-im-list', instruction: '用原列表筛选/分页回查新增课程；type固定4，若当前租户列表链路报已知500，必须报告未确认，不要重复创建。' },
    { role: 'cancel', when: '提交前用户取消', capabilityId: 'study-course-im-cancel-create', instruction: '只有尚未提交的本地draft可取消；提交后此cancel不撤销远端群组或课程行。' },
  ],
  completion: '列表回查确认目标课程行已经出现且字段与草稿一致后，才能报告创建完成。',
  idempotency: 'Portal/Java端点没有requestId；创建先调用外部群组平台再写本地课程，超时必须先回查，未确认前不得重发，否则可能产生重复群组/课程。',
}))

add('study-course-im-cancel-create', base({
  purpose: '取消尚未提交的即时通讯课程新建草稿。',
  effect: 'local',
  inputs: {},
  output: cancelOutput,
  consume: ['仅丢弃study-course-im-prepare-create的本地结果，不调用POST，也不清理任何已经提交的远端资源。'],
  steps: [],
  completion: '返回cancelled=true且没有网络副作用。',
  idempotency: null,
}))

add('study-course-im-prepare-mute', base({
  purpose: '根据课程列表行当前chatRoomMuted状态生成禁言/解禁目标状态，不发请求。',
  effect: 'prepare',
  inputs: {
    id: idInput('课程行 ID；不是roomId。', 'study-course-im-list.list[].id'),
    currentMuted: parameter('当前群聊禁言状态；Portal读取imGroupDTO.chatRoomMuted。', 'study-course-im-list.list[].imGroupDTO.chatRoomMuted', { type: 'boolean' }),
  },
  output: draftOutput('群聊禁言/解禁', [field('draft.id', 'string | number', '课程行 ID。'), field('draft.muted', 'boolean', '目标状态；按Portal逻辑对currentMuted取反。')]),
  consume: ['向用户展示“禁言”或“解禁”的目标方向；不要把课程isDel状态当作chatRoomMuted。'],
  steps: [
    { role: 'required', when: '用户确认切换群聊状态', capabilityId: 'study-course-im-mute', mapping: { draft: 'result.draft' }, instruction: '提交完整draft；目标muted已由prepare根据最新行状态取反。' },
    { role: 'cancel', when: '用户取消确认', capabilityId: 'study-course-im-cancel-mute', instruction: '丢弃草稿，不调用接口。' },
  ],
  completion: '得到目标muted已确定的本地草稿；服务端状态尚未改变。',
  idempotency: null,
}))

add('study-course-im-mute', base({
  purpose: '提交即时通讯课程群聊禁言或解禁；对应 PUT /study/course/studycourse/{id}/chatroom/mute。',
  effect: 'write',
  inputs: {
    draft: parameter('study-course-im-prepare-mute 返回的草稿。', 'study-course-im-prepare-mute.draft', { type: 'object' }),
    'draft.id': idInput('课程行 ID。', 'prepare-mute.draft.id'),
    'draft.muted': parameter('目标禁言状态。', 'prepare-mute.draft.muted', { type: 'boolean' }),
  },
  output: muteOutput,
  consume: ['请求方法为PUT，URL为/study/course/studycourse/{id}/chatroom/mute，query为{muted:boolean}，请求body必须是null；不要发送JSON对象body。', '成功或超时后重新读取课程行，确认imGroupDTO.chatRoomMuted与draft.muted一致；空回执不是最终证据。'],
  steps: [
    { role: 'required', when: '请求成功或超时', capabilityId: 'study-course-im-list', instruction: '回查目标课程行的chatRoomMuted；type固定4。当前租户列表已知500条上限错误时报告未确认，不要重发切换。' },
    { role: 'cancel', when: '提交前用户取消', capabilityId: 'study-course-im-cancel-mute', instruction: '仅取消本地草稿；已经提交的禁言/解禁没有通用回滚操作，若要反向切换必须重新prepare并经用户确认。' },
  ],
  completion: '回查确认chatRoomMuted等于目标muted后报告禁言或解禁完成。',
  idempotency: '端点没有requestId；重复请求会再次执行状态切换语义，超时先回查，不自动重发。',
}))

add('study-course-im-cancel-mute', base({
  purpose: '取消尚未提交的群聊禁言/解禁草稿。',
  effect: 'local',
  inputs: {},
  output: cancelOutput,
  consume: ['只丢弃prepare-mute草稿；不调用chatroom/mute，不改变群聊状态。'],
  steps: [],
  completion: '返回cancelled=true且没有网络副作用。',
  idempotency: null,
}))

const messageStatusInputs = {
  draft: parameter('study-course-im-prepare-message-status 返回的草稿。', 'study-course-im-prepare-message-status.draft', { type: 'object' }),
  'draft.id': idInput('互动消息 ID。', 'prepare-message-status.draft.id'),
  'draft.status': parameter('绝对目标状态；0无效、1有效，SDK不在提交阶段再次取反。', 'prepare-message-status.draft.status', { type: '0 | 1', options: [{ value: 0, label: '无效' }, { value: 1, label: '有效' }] }),
}

add('study-course-im-prepare-message-status', base({
  purpose: '校验互动消息 ID和绝对目标有效状态，生成消息状态更新草稿。',
  effect: 'prepare',
  inputs: {
    id: idInput('互动消息 ID；来自隐藏消息页当前行。', 'study-course-im-message-list.list[].id'),
    status: parameter('要提交的绝对目标状态；0无效、1有效。', '用户确认的消息状态', { type: '0 | 1', options: [{ value: 0, label: '无效' }, { value: 1, label: '有效' }] }),
  },
  output: draftOutput('互动消息状态更新', [field('draft.id', 'string | number', '互动消息 ID。'), field('draft.status', '0 | 1', '绝对目标状态。', { values: { '0': '无效', '1': '有效' } })]),
  consume: ['页面当前消息列表的状态操作模板被注释，但Portal脚本保留onUpdateStatus且Java端点存在；本能力不把当前页面不可见按钮说成可点击UI。'],
  steps: [
    { role: 'required', when: '调用方明确确认状态更新', capabilityId: 'study-course-im-message-status', mapping: { draft: 'result.draft' }, instruction: '原样提交绝对status，不根据旧状态自行取反。' },
    { role: 'cancel', when: '用户取消', capabilityId: 'study-course-im-cancel-message-status', instruction: '丢弃本地草稿，不发请求。' },
  ],
  completion: '得到通过本地状态校验的消息状态草稿；尚未调用外部消息平台。',
  idempotency: null,
}))

add('study-course-im-message-status', base({
  purpose: '更新隐藏互动消息的有效状态；对应 PUT /study/interaction/updateStatus，并由Java服务继续调用外部消息平台。',
  effect: 'write',
  inputs: messageStatusInputs,
  output: undefinedOutput,
  consume: ['请求体严格为{id,status}，不是draft包装；成功或超时后用同一id、roomId回查互动消息，若列表不返回status则只能报告服务端回查限制，不伪造状态。'],
  steps: [
    { role: 'required', when: '请求成功或超时且有原roomId', capabilityId: 'study-course-im-message-list', mapping: { id: 'context.roomIdCourseId', roomId: 'context.roomId' }, instruction: '使用提交前保存的课程行ID和群组ID回查消息；提交draft.id只是消息ID，不能拿它代替查询所需课程行ID。' },
    { role: 'cancel', when: '提交前用户取消', capabilityId: 'study-course-im-cancel-message-status', instruction: '提交后cancel不撤销外部消息平台更新；需要反向状态时必须重新准备绝对目标值。' },
  ],
  completion: '服务端回查确认消息目标状态，或明确记录外部状态不可独立读取后，才能报告结果；HTTP成功本身不够。',
  idempotency: '没有requestId，Java服务会调用外部消息平台；超时先按消息ID和群组ID回查，未确认不得重复更新。',
}))

add('study-course-im-cancel-message-status', base({
  purpose: '取消尚未提交的互动消息状态更新草稿。',
  effect: 'local',
  inputs: {},
  output: cancelOutput,
  consume: ['只丢弃prepare-message-status结果，不调用外部消息平台。'],
  steps: [],
  completion: '返回cancelled=true且没有网络副作用。',
  idempotency: null,
}))

const audioStatusInputs = {
  draft: parameter('study-course-im-prepare-audio-status 返回的草稿。', 'study-course-im-prepare-audio-status.draft', { type: 'object' }),
  'draft.id': idInput('合并语音记录 ID。', 'prepare-audio-status.draft.id'),
  'draft.roomId': parameter('即时通讯群组 ID。', 'prepare-audio-status.draft.roomId', { type: 'string' }),
  'draft.status': parameter('绝对目标发布状态；0未发布、1已发布。', 'prepare-audio-status.draft.status', { type: '0 | 1', options: [{ value: 0, label: '未发布' }, { value: 1, label: '已发布' }] }),
  'draft.lessonId': optional('关联班课 ID；有值时按Portal追加multipart字段。', 'prepare-audio-status.draft.lessonId', '无值时不追加lessonId', { type: 'string | number' }),
}

add('study-course-im-prepare-audio-status', base({
  purpose: '按合并语音当前status取反，生成发布/取消发布的multipart提交草稿。',
  effect: 'prepare',
  inputs: {
    id: idInput('合并语音记录 ID；来自隐藏合并语音页。', 'study-course-im-audio-list.list[].id'),
    roomId: parameter('即时通讯群组 ID。', 'study-course-im-audio-list.list[].roomId 或当前路由', { type: 'string | number' }),
    currentStatus: parameter('当前记录status；0未发布、1已发布，目标由Portal动作取反。', 'study-course-im-audio-list.list[].status', { type: '0 | 1', options: [{ value: 0, label: '未发布' }, { value: 1, label: '已发布' }] }),
    lessonId: optional('关联班课 ID；有值时随Portal追加。', 'study-course-im-audio-list.list[].lessonId', '没有关联班课时省略', { type: 'string | number' }),
  },
  output: draftOutput('合并语音发布状态', [
    field('draft.id', 'string | number', '合并语音记录 ID。'),
    field('draft.roomId', 'string', '群组 ID；FormData第一项。'),
    field('draft.status', '0 | 1', '当前状态取反后的绝对目标值。', { values: { '0': '未发布', '1': '已发布' } }),
    field('draft.lessonId', 'string | number', '可选班课 ID；有值才追加到FormData。', { optional: true, nullable: true, nullMeaning: '没有关联班课，不发送该键' }),
  ]),
  consume: ['向用户展示当前状态和目标状态；prepare只计算目标，不修改record对象或服务端。'],
  steps: [
    { role: 'required', when: '用户确认发布/取消发布', capabilityId: 'study-course-im-audio-status', mapping: { draft: 'result.draft' }, instruction: '原样提交draft；SDK会按Portal顺序构造roomId、id、status和可选lessonId的FormData。' },
    { role: 'cancel', when: '用户取消', capabilityId: 'study-course-im-cancel-audio-status', instruction: '丢弃草稿，不发送multipart请求。' },
  ],
  completion: '得到目标发布状态已明确的本地草稿；服务端状态尚未改变。',
  idempotency: null,
}))

add('study-course-im-audio-status', base({
  purpose: '发布或取消发布一条合并语音；对应 PUT /study/audio/updateStatus 的multipart请求。',
  effect: 'write',
  inputs: audioStatusInputs,
  output: undefinedOutput,
  consume: ['请求体不是JSON，而是FormData，键顺序和名称为roomId、id、status以及有值时的lessonId；成功或超时后重新读取同一roomId的音频列表。', '不能用返回undefined判断status已更新；回查应核对list[].id和list[].status。'],
  steps: [
    { role: 'required', when: '请求成功或超时', capabilityId: 'study-course-im-audio-list', mapping: { roomId: 'args.draft.roomId' }, instruction: '回查目标记录status；如果请求超时，先回查再决定是否需要重新提交。' },
    { role: 'cancel', when: '提交前用户取消', capabilityId: 'study-course-im-cancel-audio-status', instruction: '提交后cancel不恢复旧发布状态；要反向操作必须读取最新status后重新prepare。' },
  ],
  completion: '音频列表回查确认目标记录status等于draft.status后报告发布状态变更完成。',
  idempotency: '端点没有requestId；同一状态重复提交可能产生重复日志/业务副作用，超时先回查。',
}))

add('study-course-im-cancel-audio-status', base({
  purpose: '取消尚未提交的合并语音发布状态草稿。',
  effect: 'local',
  inputs: {},
  output: cancelOutput,
  consume: ['只丢弃prepare-audio-status结果，不调用/study/audio/updateStatus。'],
  steps: [],
  completion: '返回cancelled=true且没有网络副作用。',
  idempotency: null,
}))

const audioDeleteInputs = {
  draft: parameter('study-course-im-prepare-audio-delete 返回的草稿。', 'study-course-im-prepare-audio-delete.draft', { type: 'object' }),
  'draft.ids': parameter('待删除合并语音记录 ID数组；提交时直接作为JSON数组body。', 'prepare-audio-delete.draft.ids', { type: '(string | number)[]', constraints: ['非空', '每项为安全正整数或无前导零的正整数字符串'] }),
}

add('study-course-im-prepare-audio-delete', base({
  purpose: '校验待删除合并语音记录 ID数组，生成Portal批量删除草稿。',
  effect: 'prepare',
  inputs: {
    ids: parameter('待删除合并语音记录 ID数组；单删也按数组发送。', 'study-course-im-audio-list.list[].id', { type: '(string | number)[]', constraints: ['非空', 'ID不重复更易核对'] }),
  },
  output: draftOutput('合并语音删除', [field('draft.ids', '(string | number)[]', '待删除记录 ID数组；DELETE body直接使用该数组。')]),
  consume: ['删除是服务端删除/软删除动作；向用户展示完整ID或对应记录并取得确认。'],
  steps: [
    { role: 'required', when: '用户确认删除', capabilityId: 'study-course-im-audio-delete', mapping: { draft: 'result.draft' }, instruction: '把完整draft传给提交能力；不要包成{ids:[...]}，Portal/Java接收的是Long[]原始数组。' },
    { role: 'cancel', when: '用户取消确认', capabilityId: 'study-course-im-cancel-audio-delete', instruction: '丢弃草稿，不调用DELETE。' },
  ],
  completion: '得到已确认的非空ID数组草稿；尚未删除服务端记录。',
  idempotency: null,
}))

add('study-course-im-audio-delete', base({
  purpose: '删除隐藏合并语音页选中的一条或多条合并语音记录；对应 DELETE /study/audio。',
  effect: 'write',
  inputs: audioDeleteInputs,
  output: undefinedOutput,
  consume: ['请求body严格为[...id]的JSON数组，不是{ids:[...]}；成功或超时后必须用同一roomId重新查询并核对目标记录已不再可见或isDel=1。', '删除外部OSS音频文件的最终回收语义由Java服务决定；SDK不声称可恢复。'],
  steps: [
    { role: 'required', when: '请求成功或超时且保留了提交前roomId', capabilityId: 'study-course-im-audio-list', mapping: { roomId: 'context.roomId' }, instruction: '回查每个目标ID；不要把空页直接解释成权限成功，需核对筛选和total。' },
    { role: 'cancel', when: '提交前用户取消', capabilityId: 'study-course-im-cancel-audio-delete', instruction: '提交后cancel不能恢复已删除记录；需要保留时不得先提交。' },
  ],
  completion: '音频列表回查确认目标记录已按服务端语义删除后报告完成；仅HTTP成功不够。',
  idempotency: '端点没有requestId；删除请求超时先回查，不要盲目再次发送原数组。',
}))

add('study-course-im-cancel-audio-delete', base({
  purpose: '取消尚未提交的合并语音删除草稿。',
  effect: 'local',
  inputs: {},
  output: cancelOutput,
  consume: ['只丢弃prepare-audio-delete结果，不调用DELETE；已提交删除没有本地恢复语义。'],
  steps: [],
  completion: '返回cancelled=true且没有网络副作用。',
  idempotency: null,
}))

const audioMergeInputs = {
  draft: parameter('study-course-im-prepare-audio-merge 返回的草稿。', 'study-course-im-prepare-audio-merge.draft', { type: 'object' }),
  'draft.lessonId': idInput('所选语音记录关联的班课 ID。', 'prepare-audio-merge.draft.lessonId'),
  'draft.lessonName': optional('班课名称；Portal始终带该键，缺省时SDK发送空字符串。', 'prepare-audio-merge.draft.lessonName', '使用空字符串', { type: 'string', default: '空字符串' }),
  'draft.roomId': parameter('即时通讯群组 ID。', 'prepare-audio-merge.draft.roomId', { type: 'string' }),
  'draft.fileList': parameter('至少两个外部音频 URL；来自消息页type=2记录的content并经用户确认。', 'prepare-audio-merge.draft.fileList', { type: 'string[]', constraints: ['长度至少2', '每项非空'] }),
}

add('study-course-im-prepare-audio-merge', base({
  purpose: '校验隐藏语音合并弹窗选中的班课、群组和至少两个外部音频地址，生成Portal MergeDTO草稿。',
  effect: 'prepare',
  inputs: {
    lessonId: idInput('所选音频对应的班课 ID。', 'study-course-im-message-list.list[].lessonId 或用户确认的班课选择'),
    lessonName: optional('班课名称；Portal props required但调用方缺省时SDK使用空字符串。', '消息页/班课选择组件', '发送空字符串', { type: 'string', default: '空字符串' }),
    roomId: parameter('即时通讯群组 ID。', '当前隐藏消息路由roomId', { type: 'string | number' }),
    fileList: parameter('选中的音频内容 URL列表。', 'study-course-im-message-list.list[].content（仅type=2）', { type: 'string[]', constraints: ['至少两个', '每项为非空字符串'] }),
  },
  output: draftOutput('即时通讯课程语音合并', [
    field('draft.lessonId', 'string | number', '班课 ID。'),
    field('draft.lessonName', 'string', '班课名称；缺省为空字符串。'),
    field('draft.roomId', 'string', '群组 ID。'),
    field('draft.fileList', 'string[]', '外部音频 URL列表；顺序保持用户选择顺序。'),
    field('draft.fileList[]', 'string', '一个待下载并合并的外部音频 URL。'),
  ]),
  consume: ['展示将被下载合并的音频数量、lessonId和roomId；prepare不下载文件、不上传OSS、不创建音频记录。'],
  steps: [
    { role: 'required', when: '用户确认开始合并', capabilityId: 'study-course-im-audio-merge', mapping: { draft: 'result.draft' }, instruction: '原样传完整draft；不要把content URL转成浏览器下载结果或改变数组顺序。' },
    { role: 'cancel', when: '用户关闭合并弹窗或取消', capabilityId: 'study-course-im-cancel-audio-merge', instruction: '丢弃草稿，不下载、合并或上传。' },
  ],
  completion: '得到至少两个音频地址组成的本地MergeDTO草稿；合并尚未开始。',
  idempotency: null,
}))

add('study-course-im-audio-merge', base({
  purpose: '提交语音合并草稿；对应 POST /study/audioMerge，服务端下载外部音频、FFmpeg合并、上传OSS并在有roomId时保存未发布记录。',
  effect: 'write',
  inputs: audioMergeInputs,
  output: mergedUrlOutput,
  consume: ['请求body严格为{lessonId,lessonName,roomId,fileList}；成功返回非空合并音频URL。', '服务端保存的合并语音初始status=0、isDel=0；必须用study-course-im-audio-list按roomId回查记录和URL。', '合并过程中可能产生临时文件或OSS对象，返回URL后由调用方按Portal流程播放/查看；SDK不自动发布或删除。'],
  steps: [
    { role: 'required', when: '请求返回URL或超时', capabilityId: 'study-course-im-audio-list', mapping: { roomId: 'args.draft.roomId' }, instruction: '回查新的合并语音记录，核对roomId、lessonId、lessonName、url和初始status=0；超时先回查再决定是否重试。' },
    { role: 'optional', when: '用户随后确认发布新记录', capabilityId: 'study-course-im-prepare-audio-status', mapping: { id: 'context.mergedAudioId', roomId: 'args.draft.roomId', currentStatus: 'context.mergedAudioStatus', lessonId: 'context.mergedAudioLessonId' }, instruction: '必须先取得服务端新记录ID和当前status，再准备发布；不要用合并URL代替记录ID。' },
    { role: 'cancel', when: '提交前用户取消', capabilityId: 'study-course-im-cancel-audio-merge', instruction: '提交后cancel不删除OSS对象或音频记录；需要清理必须先回查记录并由用户另行确认删除。' },
  ],
  completion: '得到非空URL且音频列表回查确认记录已创建后，才能报告合并完成；未发布状态仍是0。',
  idempotency: '端点没有requestId，重复请求会重复下载、合并、上传并可能创建多条记录；超时必须先按roomId/lessonId/时间回查，不得盲目重发。',
}))

add('study-course-im-cancel-audio-merge', base({
  purpose: '取消尚未提交的语音合并草稿。',
  effect: 'local',
  inputs: {},
  output: cancelOutput,
  consume: ['只丢弃prepare-audio-merge结果，不发起文件下载、FFmpeg、OSS上传或本地音频记录保存。'],
  steps: [],
  completion: '返回cancelled=true且没有网络副作用。',
  idempotency: null,
}))

// Keep this map exact: every capability ID in STUDY_COURSE_METHODS must have a
// complete contract before the main catalog wires the file in.
const methodIds = Object.keys(STUDY_COURSE_METHODS)
const missing = methodIds.filter(id => !contracts[id])
const extra = Object.keys(contracts).filter(id => !methodIds.includes(id))
if (missing.length > 0 || extra.length > 0) {
  throw new Error(`Study course contract mapping mismatch: missing=${missing.join(',')} extra=${extra.join(',')}`)
}

export const STUDY_COURSE_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  methodIds.map(id => [id, contracts[id]!]),
)

export const STUDY_COURSE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(STUDY_COURSE_METHODS).map(([id, method]) => [
    `studyCourse.${method}`,
    {
      ...STUDY_COURSE_AI_CONTRACTS[id]!,
      boundaries: [
        ...STUDY_COURSE_AI_CONTRACTS[id]!.boundaries,
        `这是公开门面 sdk.studyCourse.${method}；prepare只产生本地草稿，cancel只丢弃未提交草稿，不能被误报为已写入或已回滚。`,
      ],
    },
  ]),
)
