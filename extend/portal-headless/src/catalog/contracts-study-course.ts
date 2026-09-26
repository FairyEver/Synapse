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

// ---------------------------------------------------------------------------
// 弹窗 / 隐藏子路由：`.lay` 网关与 zhdj-sms 上的请求
// ---------------------------------------------------------------------------
//
// 这一批与上面 23 条的区别不只是"多几个接口"，而是**三个请求层事实**：
// 1. 它们打的是**另一个 axios 实例**（`smart-layer-admin` / `zhdj-sms`，host 与主站不同），
//    请求头只有 `token` + `Accept-Language`（不发 `tenant-id`、不发 `module-type`），
//    包络也不是 `ret === 'SUCCESS'` 那一档；
// 2. 它们**没有浏览器基准**——`baseline/` 下只有那 5 条列表请求，
//    所以"逐字段一致"这一条在这里是**按源码推导**，不是比对过的；
// 3. 其中三条是**真写**，其中一条（`generatedSpeech.lay`）还是 **GET 但会写**。

/** 三个页面的弹窗与隐藏子路由共用的证据锚点（版本随用随记，conventions 第 32 条） */
const hiddenEvidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:6ac274fc9e1 app/portal/views/dashboard/education/course/{text-course,video-course,im-course}/**（含 comment/[id]/item-list.vue、[mode]/[id].vue、components/{group-owner-select,lesson-select,generated-speech-new,tag,professorList}.vue）与 app/portal/utils/http/{smart-layer-admin,zhdj-sms}.js',
    kind: 'reference',
    note: '逐处核对本节能力的请求方法、URL、参数顺序、`isOriginal`、实例归属，以及"哪个组件是活的"（generatedSpeech.vue 已无任何 import，live 的是 generated-speech-new.vue）。未把注释掉的行（视频页 `// type: record.videos.type`）当作页面行为。',
  },
  {
    source: 'SmartLayer_Java@test:483e94da525 com/wdbc/manage/controller/manage/layui/{CommentLayController#getCommentList:251, NewsLayController#generatedSpeechLay:352/#generatedSpeechByImage:399/#generatedSpeechByVoice:456, ProfessorLayController#selectAllTeacherLevel:139/#getProfessorsByMediaId:301, VideoTypeLayController#getVideoTypeTreeLay:30, LableLayController#getListLay:110}、com/wdbc/manage/controller/client/DictController#listByType:43、com/wdbc/common/util/R.java',
    kind: 'reference',
    note: '核对这一族接口的形参名、必填性、`R.ok(...)` 的响应键（`data` / `pages` / 自定义键）与真实副作用（写库、异步生成线程）。这是相对于 conventions 第 32 条那两个检出之外的**第三个检出**，分支 `test`。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:77fbc2a206c erp-module-hr/.../study/base/controller/StudyStudentController#list:48、study/lesson/controller/StudyLessonGradeRelController#getLessonListByGradeId:114、resources/mapper/study/base/StudyStudentDao.xml:443-460',
    kind: 'reference',
    note: '核对学员候选（无分页、无 LIMIT、只按 name 过滤、`is_del=0 and is_staff=1`）与班课候选的入参与返回结构；同时确认两者走的是 ERP 的 CommonResult（`portal-standard` 那一档包络）。',
  },
  {
    source: 'src/capabilities/study-course.ts',
    kind: 'implementation',
    note: '锁定本批能力的参数装配顺序、逐请求 `httpInstance`、`isOriginal` 的取舍、响应解包（`pages` / `StudyTeacherLevelDTOList` / `videoTypes` / `data`）与形状守卫。',
  },
  {
    source: 'src/context/http-instance.ts、src/http/client.ts 的 applyEnvelope',
    kind: 'implementation',
    note: '证明两个实例的画像差异（headerMode、tokenInParams、响应档）：`smart-layer-admin` 是 smart-layer 档，`zhdj-sms` 是 zhdj-sms 档且 `code === 200` 时不抛。测试环境两者 baseURL env 取值相同，但规则不同。',
  },
]

const hiddenGaps = [
  '本轮**没有对测试环境发过任何请求**：请求形状、参数顺序与响应解包都来自固定检出源码 + 离线测试，未做线上冒烟。`baseline/` 下也没有这一批的浏览器基准，所以"与页面逐字段一致"是按源码推导，不是比对过的。',
  '`baseUrls["smart-layer-admin"]` / `baseUrls["zhdj-sms"]` 必须由调用方显式配置，没配就拒绝发请求（失败闭合）。本轮没有在真实环境验证过这两个 baseURL 指向可用。',
  '视频课程评论页的 `userName` / `userPhone` 与后端形参 `username` / `phone` 不对应、筛选实际不生效，这一条是前后端源码逐字对照得出的，没有实测确认。',
  '评论页的 `startTime` / `endTime` 参数，后端声明的是 `@DateTimeFormat(pattern = "yyyy-MM-dd") Date`，而页面发的是 `YYYY-MM-DD HH:mm:ss`。时间部分会被怎么处理（截断/报错）没有实测，只有"照抄页面的形状"这一条是确定的。',
  '`listVideoTypes` 返回的 `videoTypes` 元素是否带 `child` 树、页面下拉是否只用到扁平一层，没有实测（页面只用 `title` / `type`）。',
  '图文课程编辑页的标签候选走的是另一个接口 `/tag/list.lay?typeList=1`（另一个同名组件、返回 `{id,name}` 而不是字符串），**不在本次派单范围内**，未做成能力。',
]

const HIDDEN_BOUNDARIES = [
  '这一批请求的页面上下文沿用所属**列表页**（`/dashboard/course/{text-course,video-course,im-course}/list`）：弹窗与隐藏子路由没有独立菜单项，也没有独立权限码，module-type 由列表页路径推导。',
  '它们打的是**另一个 axios 实例**：`smart-layer-admin`（`.lay` 网关）或 `zhdj-sms`（生成语音弹窗）。这两个实例**不发 `tenant-id`、不发 `module-type`**，请求头只有 `token` + `Accept-Language` —— 这是实例画像决定的，不要拿主站那一组请求头去核对。',
  '实例的 baseURL 属于「同 host 不同前缀要不要支持」那个未决范围，SDK 不替调用方决定：必须显式配置，否则拒绝发请求（conventions 第 27 条）。',
  '本批全部是**离线形状**交付：请求形状来自固定检出源码，没有浏览器基准比对，也没有线上冒烟。不要据此宣称已在真实环境生效。',
]

const HIDDEN_PREREQUISITES = [
  '使用当前用户会话、租户与课程页面上下文创建 SDK；本批请求的凭据与主站列表共用同一份会话 token。',
  '调用方必须在 `createPageCall` / 门面的 `httpBaseUrls` 里给 `smart-layer-admin` 与 `zhdj-sms` 配 baseURL，否则这些能力会以 `HttpInstanceResolutionError` 失败（这是刻意的，不是配置遗漏）。',
]

const HIDDEN_FAILURES = [
  '解析不到实例（没配 baseURL）时**在发请求前**抛 `HttpInstanceResolutionError`；这与"少数一个请求头"不同档，不能当成网络抖动重试。',
  '响应形状变了（缺 `pages` / 缺约定的业务键 / 不是数组）会当场抛错，**不降级为空列表**——静默空列表会让调用方以为"真的没有数据"。',
  '业务失败按各实例自己的包络抛 `PortalApiError`：`.lay` 网关看 `code !== 200`；`zhdj-sms` 先看 `ret` 再看 `code`，且 `ret !== "SUCCESS"` 而 `code === 200` 时**不抛**（会返回 undefined）。不要用"没抛错"推断业务成功。',
]

/**
 * 隐藏面契约的公共外壳。
 *
 * 与 `base()` 分开是**刻意**的：`base()` 的 `whenToUse` / `boundaries` / `gaps` 全是
 * 即时通讯课程隐藏动作那一套（新建、禁言、消息、合并语音），套到评论页和生成语音上
 * 就是通用模板句。这一批要有自己的边界与缺口。
 */
function hidden (
  value: Omit<AiContract, 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'> & {
    boundaries?: string[]
    prerequisites?: string[]
    failures?: string[]
  },
): AiContract {
  return {
    ...value,
    boundaries: [...HIDDEN_BOUNDARIES, ...(value.boundaries ?? [])],
    prerequisites: [...HIDDEN_PREREQUISITES, ...(value.prerequisites ?? [])],
    failures: [...HIDDEN_FAILURES, ...(value.failures ?? [])],
    evidence: hiddenEvidence,
    gaps: hiddenGaps,
  }
}

/** 「返回一个数组」的输出形状：这一批里有 4 条接口回的不是 `{list, total}` */
const arrayOutput = (label: string, fields: AiField[], empty: string): AiContract['output'] => ({
  shape: 'object[]',
  fields: [
    field('$', 'object[]', `${label}的完整数组。**不是** { list, total } 分页结构。`),
    field('[]', 'object', `一名${label.replace(/候选$|列表$/, '')}。`),
    ...fields,
  ],
  empty,
})

/** 与 `idInput` 同义，只是措辞按"远端资源 id"来说明 */
const remoteIdInput = (meaning: string, source: string): AiParameter => idInput(meaning, source)

add('study-course-im-student-list', hidden({
  purpose: '按姓名关键字查询即时通讯课程隐藏新建表单的「群主」候选学员，供 staffCode 取值。',
  whenToUse: '用户要新建即时通讯课程、需要挑群主，且只知道姓名片段（或需要确认工号）时用它。它与讲师候选（`/manage/getAllProfessorPage.lay`）、组织人员候选都不是同一份名单：这里返回的是"在职学员"。',
  effect: 'read',
  inputs: {
    keyword: parameter(
      '学员姓名关键字，后端按 `name LIKE %关键字%` 过滤。**必须非空。**',
      '用户提供的姓名片段（如「张」）',
      {
        type: 'string',
        constraints: [
          'SDK 校验：去首尾空白后必须非空；为空直接抛错，不发请求。',
          '后端规则：只按 name 模糊匹配，且额外限定 `is_del=0 and is_staff=1`。',
          '这条接口没有分页也没有 LIMIT —— 关键字越短返回越多，单字可能拉回几千行，建议先要更长的姓名片段。',
        ],
      },
    ),
  },
  output: arrayOutput('群主候选', [
    field('[].id', 'number | null', '学员记录 id。**不是提交给新建接口的值**。', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].name', 'string | null', '学员姓名；展示用。', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].staffCode', 'string | number | null', '工号。**群主提交的就是它**（表单字段名也是 staffCode）。', { nullable: true, nullMeaning: '该学员没有工号或后端未返回；这种行不能选作群主' }),
    field('[].mobile', 'string | number | null', '手机号；页面不展示，原样保留。', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].organizationName', 'string | null', '所属组织名（后端用 `hr_study_organization.full_path` 兜 `hr_organization` 拼出来的）。', { nullable: true, nullMeaning: '后端未返回' }),
  ], '返回 `[]` 表示这个关键字没有匹配到任何在职学员（后端 SQL 带 `is_del=0 and is_staff=1`）；它不是权限判定，也不代表这一页坏了。响应不是数组时抛错。'),
  consume: [
    '把 `[].name` 给用户看、把选中那一行的 `[].staffCode` 作为表单值：两者不能互换，**也不能拿 `[].id` 代替 `staffCode`**（后端只认工号）。',
    '返回的是**过滤后的全集**，没有分页字段可用；不要以为 `total` 之外还有下一页。',
    '要在候选上显示讲师级别中文名，需要另取 `study-course-im-owner-level-options`，再按候选行的 `level` 相等匹配；本能力返回里没有级别字段。',
  ],
  steps: [
    {
      role: 'optional',
      when: '用户已经确认了群主，且准备提交隐藏新建表单',
      capabilityId: 'study-course-im-prepare-create',
      mapping: { 'form.staffCode': 'result.[].staffCode' },
      instruction: '只取用户选中那一行的 staffCode 传给 form.staffCode；把 name 与 staffCode 一起展示给用户确认，但 name 不进表单。',
    },
  ],
  completion: '返回该关键字下的候选数组供用户选择；读取本身不修改任何数据。',
  idempotency: null,
}))

add('study-course-im-owner-level-options', hidden({
  purpose: '取全部启用中的讲师级别，用来把候选里的 level 数字渲染成中文级别名。',
  whenToUse: '只在需要把讲师/群主候选上的 `level` 显示成中文名时用它；它不返回任何讲师，只是一张「级别 → 名称」的对照表。要讲师或群主本人请用讲师候选（`/manage/getAllProfessorPage.lay`）或 study-course-im-student-list。',
  effect: 'read',
  inputs: {},
  output: arrayOutput('讲师级别候选', [
    field('[].id', 'number | null', '级别记录 id。', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].name', 'string | null', '级别中文名；页面展示的就是它。', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].level', 'number | null', '级别等级（数字）。**与候选行做相等匹配用的就是它**。', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].sort', 'number | null', '排序值。', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].status', 'number | null', '启用状态；0 未启用、1 已启用。接口名义上只回启用中的，仍原样带回。', { nullable: true, values: { '0': '未启用', '1': '已启用' }, nullMeaning: '后端未返回' }),
    field('[].isDel', 'number | null', '软删除标记；0 未删除、1 已删除。', { nullable: true, values: { '0': '未删除', '1': '已删除' }, nullMeaning: '后端未返回' }),
  ], '返回 `[]` 表示当前租户还没有配置任何讲师级别；这不是权限判定。业务数据在响应体的 `StudyTeacherLevelDTOList` 键上，缺这个键时抛错（形状变了要当场失败，不能当成"没有级别"）。'),
  consume: [
    '把候选行里的 `level` 与本表的 `[].level` 做**相等**比较取 `[].name`（页面 `getTeacherLevelName` 就是这么写的）；不要拿 `name` 去比，也不要把两级编号混成字符串比较。',
    '两个接口返回的是不同实体：`level` 是这里的匹配键，`staffCode` 是群主表单值，`id` 两边都不是提交值。',
    '这是一个无参全量字典（后端 `@GetMapping("selectAllTeacherLevel.lay")` 一个形参都没有），可以整表取回当对照表缓存。',
  ],
  steps: [
    {
      role: 'optional',
      when: '用户正在挑群主/讲师且界面上要显示级别中文名',
      capabilityId: 'study-course-im-student-list',
      mapping: { keyword: 'user.姓名片段' },
      instruction: '取回候选后，用本表按 level 相等匹配出中文级别名展示；提交给表单的仍然是候选行的 staffCode，不是这里的 id。',
    },
  ],
  completion: '返回级别对照表供本地匹配；读取本身不修改任何数据。',
  idempotency: null,
}))

add('study-course-im-lesson-list', hidden({
  purpose: '按班级 ID 取该班级下的班课候选，供隐藏新建表单与语音合并弹窗选择班课。',
  whenToUse: '已经确定班级、要选班课时用它。它与即时通讯课程列表（`study-course-im-list`）不是一回事：这里按 `gradeId` 过滤班课，返回的是候选而不是课程行。',
  effect: 'read',
  inputs: {
    gradeId: idInput('班级 ID。来自班级候选（页面是 `component-grade-select` 的下拉），不能拿班级名称或班课 id 代替。', '班级候选组件的选中值'),
  },
  output: arrayOutput('班课候选', [
    field('[].id', 'string | number | null', '班课 ID。**这是选班课后要用的值**（页面把它写进 `lessonId` / `firstId`）。', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].title', 'string | null', '班课名称；页面下拉的 label。', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].teacherName', 'string | null', '讲师姓名。页面下拉不展示，原样保留。', { nullable: true, nullMeaning: '后端未返回' }),
  ], '返回 `[]` 表示这个班级下没有班课（或没有达标班课）；不是权限判定。响应不是数组时抛错。'),
  consume: [
    '用 `[].title` 展示、用 `[].id` 作为后续调用的 `lessonId`；不要用班课名称去调下游。',
    '页面拿到结果后会把**第一项**默认选中（`lesson-select.vue` 的 `watchEffect`），无头下要不要默认选由调用方决定，但把候选整表给用户看更安全。',
    '这一条接口没有分页：返回的是该班级下的全部候选。',
  ],
  steps: [
    {
      role: 'optional',
      when: '用户确认了班课并要合并语音',
      capabilityId: 'study-course-im-prepare-audio-merge',
      mapping: { lessonId: 'result.[].id', lessonName: 'result.[].title' },
      instruction: '把选中那一行的 id 传给 lessonId、title 传给 lessonName；两者必须来自同一行。',
    },
    {
      role: 'optional',
      when: '用户确认了班级并要新建即时通讯课程',
      capabilityId: 'study-course-im-prepare-create',
      mapping: { 'form.gradeId': 'args.gradeId' },
      instruction: '新建表单要的是班级 ID（gradeId）本身，不是班课 ID —— 不要把这里的 lessonId 填进去。',
    },
  ],
  completion: '返回指定班级下的班课候选；读取本身不修改任何数据。',
  idempotency: null,
}))

const commentRowFields = (label: string): AiField[] => [
  field('id', 'number | null', '评论 ID。页面「ID」列；当前 SDK 没有做置顶/删除动作，所以它只用于核对。', { nullable: true, nullMeaning: '后端未返回' }),
  field('content', 'string | null', '评论内容。页面用省略号单行展示。', { nullable: true, nullMeaning: '后端未返回' }),
  field('commentType', 'number | null', '评论层级；页面文案是"1 → 一级评论，其余 → 二级评论"。', { nullable: true, values: { '1': '一级评论', '2': '二级评论' }, nullMeaning: '后端未返回；页面按二级评论展示' }),
  field('newsTitle', 'string | null', `这条评论挂在哪条内容上（${label}的标题）。`, { nullable: true, nullMeaning: '后端未返回' }),
  field('userName', 'string | null', '评论人姓名。', { nullable: true, nullMeaning: '后端未返回' }),
  field('userPhone', 'string | null', '评论人手机号；页面直接展示原值。', { nullable: true, nullMeaning: '后端未返回' }),
  field('top', 'number | null', '置顶标记；页面文案是"1 → 置顶，其余 → 未置顶"。', { nullable: true, values: { '1': '置顶' }, nullMeaning: '后端未返回；页面按未置顶展示' }),
  field('createTimeStr', 'string | null', '评论时间。后端已经格式化好，页面直接展示原值，SDK 不换算时区、不改格式。', { nullable: true, nullMeaning: '后端未返回' }),
]

const commentInputs = (kind: '图文' | '视频'): Record<string, AiParameter> => ({
  newsId: remoteIdInput(
    `${kind}课程的**远端资源 id**：图文页取列表行的 \`news.id\`，视频页取 \`videos.id\`；**不是课程行 id**（两者是不同主键，互换会查到别的内容或空页）。`,
    kind === '图文' ? 'study-course-text-list.list[].news.id' : 'study-course-video-list.list[].videos.id',
  ),
  userName: optional(
    kind === '图文' ? '评论人筛选。' : '评论人筛选。⚠️ 视频页发的是 `userName`，而后端形参名是 `username` —— 这个筛选**实际不生效**。',
    '用户在评论页「评论人」输入框里填的值',
    '发送空字符串（页面无筛选时也照样发）',
    { type: 'string', default: '空字符串' },
  ),
  userPhone: optional(
    kind === '图文' ? '手机号筛选。' : '手机号筛选。⚠️ 视频页发的是 `userPhone`，而后端形参名是 `phone` —— 这个筛选**实际不生效**。',
    '用户在评论页「手机号」输入框里填的值',
    '发送空字符串',
    { type: 'string', default: '空字符串' },
  ),
  content: optional('评论内容筛选。', '用户在评论页「评论内容」输入框里填的值', '发送空字符串', { type: 'string', default: '空字符串' }),
  startTime: optional('评论时间起，YYYY-MM-DD HH:mm:ss。', '用户选择的时间区间；建议用 buildStudyCourseTimeRange', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
  endTime: optional('评论时间止；页面按结束日次日 00:00:00 发送开区间边界。', '用户选择的时间区间；建议用 buildStudyCourseTimeRange', '发送空字符串', { type: 'string', format: 'YYYY-MM-DD HH:mm:ss' }),
  page: optional('从 1 开始的页码。**参数名是 page，不是 pageNo**。', '调用方分页状态', 'SDK 使用 1', { type: 'integer', default: '1', constraints: ['正整数'] }),
  limit: optional('每页条数。**是 limit，不是 pageSize**（页面把列表模块的 pageSize 转成了这个名字）。', '调用方分页状态', 'SDK 使用 20', { type: 'integer', default: '20', constraints: ['正整数', '后端同名参数的默认值是 10，SDK 按页面发 20'] }),
})

add('study-course-text-comment-list', hidden({
  purpose: '查询指定图文课程（远端 news id）下的评论分页，供「查看评论」隐藏路由展示。',
  whenToUse: '用户从图文课程列表点「查看评论」、或要核对某条图文内容的评论时用它。内容本体请用 study-course-text-list；这条只回评论。',
  effect: 'read',
  inputs: commentInputs('图文'),
  output: pageOutput(commentRowFields('图文课程'), '图文课程评论'),
  consume: [
    '按页面 8 列展示：id、content、commentType、newsTitle、userName、userPhone、top、createTimeStr；commentType 与 top 的文案按各自 values 映射，未知值不要猜成一级评论或已置顶。',
    '`newsId` 必须是**图文资源 id**：从 study-course-text-list 的 `list[].news.id` 取，不是 `list[].id`。写错了会得到空页而不是报错。',
    '`limit` 默认 20（页面 `useListPageModule(styleV2)`），后端同名参数默认 10 —— 以 SDK 发出去的为准。需要完整清单时递增 `page` 直到覆盖 `total`，不要把当前页当全集。',
    '筛选字段名与视频课程**不同**（这里是 `username` / `phone`），后端只认这一组；两页的输入在 SDK 里都叫 `userName` / `userPhone`，映射由实现负责。',
  ],
  steps: [],
  completion: '返回该图文内容下的评论当前页；读取不修改任何数据。页面上还有置顶/删除动作，SDK 未实现（见 boundaries）。',
  idempotency: null,
  boundaries: [
    '评论页上还有「置顶/取消置顶」「删除」两个动作（`/manage/updateComment.lay` 等），本次没有做成能力；本能力只读。',
    '评论页的 `startTime` / `endTime` 后端声明的是 `@DateTimeFormat(pattern = "yyyy-MM-dd") Date`，而页面发的是带时分秒的字符串；时间部分会被怎么处理没有实测（见 gaps），SDK 只保证"发的是页面会发的那个形状"。',
  ],
}))

add('study-course-video-comment-list', hidden({
  purpose: '查询指定视频课程（远端 videos id）下的评论分页，供「查看评论」隐藏路由展示。',
  whenToUse: '用户从视频课程列表点「查看评论」、或要核对某条视频内容的评论时用它。内容本体请用 study-course-video-list；这条只回评论。',
  effect: 'read',
  inputs: commentInputs('视频'),
  output: pageOutput(commentRowFields('视频课程'), '视频课程评论'),
  consume: [
    '按页面 8 列展示：id、content、commentType、newsTitle、userName、userPhone、top、createTimeStr；commentType 与 top 的文案按各自 values 映射。',
    '`newsId` 必须是**视频资源 id**：从 study-course-video-list 的 `list[].videos.id` 取，不是 `list[].id`。',
    '⚠️ **`userName` / `userPhone` 这两个筛选在这一页实际不生效**：页面发的是这两个名字，而后端形参叫 `username` / `phone`，Spring 忽略多余的 query 参数、请求照样 200。SDK 照抄页面形状（改了就不与页面逐字段一致），调用方不要依赖这两个条件收窄结果，用完请按返回内容自行核对。',
    '`limit` 默认 20（后端默认 10）；需要完整清单时递增 `page` 直到覆盖 `total`。',
  ],
  steps: [],
  completion: '返回该视频内容下的评论当前页；读取不修改任何数据。',
  idempotency: null,
  boundaries: [
    '与图文课程评论页共用同一个后端接口，靠 `type=2` 分片；两个筛选字段名与图文页不同，且在后端没有落点（见 consume）。',
    '评论页上还有「置顶/取消置顶」「删除」两个动作，本次没有做成能力；本能力只读。',
  ],
}))

add('study-course-text-voice-list', hidden({
  purpose: '取语音播报人（讯飞发音人）候选，供图文课程「生成语音」弹窗选择 voiceName。',
  whenToUse: '用户要生成语音、需要选/展示播报人时用它。它只给候选；真正发起生成的是 study-course-text-generated-speech 一族。',
  effect: 'read',
  inputs: {},
  output: arrayOutput('播报人候选', [
    field('[].label', 'string', '播报人显示名；只用于展示。'),
    field('[].value', 'string', '播报人标识（如 `x2_qige`）。**它就是提交给 voiceName 的值**。'),
  ], '返回 `[]` 表示当前租户没有配置任何发音人；不是权限判定。响应不是数组时会抛错；元素缺 `value` 也抛错（缺了它就无法提交）。'),
  consume: [
    '用 `[].label` 展示、把选中那一项的 `[].value` 传给生成语音能力的 `voiceName`；不要把 label 传进去。',
    '页面为这个下拉准备的默认值是 `x2_qige`（`generated-speech-new.vue:132`）；如果候选里没有它，说明字典已变，要按候选重新选。',
    '后端字典行还有 `id` / `type` / `sort` / `description` 等字段，**不在页面的消费契约里**：页面只把 label/value 交给下拉框，SDK 也只返回这两项。',
  ],
  steps: [
    {
      role: 'optional',
      when: '用户确认了播报人并要发起生成',
      capabilityId: 'study-course-text-generate-speech',
      mapping: { voiceName: 'result.[].value' },
      instruction: '把选中那一项的 value 传给 voiceName；三种生成方式（识别文字 / 识别图片 / 上传语音）用的是同一个 voiceName。',
    },
  ],
  completion: '返回播报人候选供用户选择；读取本身不修改任何数据，也不触发任何生成。',
  idempotency: null,
  boundaries: [
    '字典类型写在**路径**上（后端是 `@RequestMapping("/{type}.lay")`，`type` 是路径变量），所以这条能力没有参数，也不能用来查别的字典。',
    '这条请求走的是 `zhdj-sms` 实例（页面 import 的 `zhdjCMSHttp` 来自 `utils/http/zhdj-sms.js`）。同仓库里还有一个**已经不用的**同名弹窗 `generatedSpeech.vue` 用 `smart-layer-admin` 打同一路径 —— 它已无任何 import，不作为依据。',
  ],
}))

const speechOutput = undefinedOutput

/** 三个生成分支共用的"异步生成"事实 */
const SPEECH_ASYNC_FACTS = [
  '成功返回 `undefined` 只代表后端**已受理**（响应是 `R.ok(200,"正在生成")`，没有业务 data）；后端把 MP3 生成提交给**异步线程池**，不是同步完成。',
  '判断结果只能回查 `study-course-text-list` 的 `news.voiceState`：2 生成中 / 0 成功 / 1 失败；必须是"回查到终态"，不能把接口 200 当成生成成功。',
  '请求超时**先回查 voiceState**，不要直接重发：重复提交会再走一次写库与生成线程。',
]

add('study-course-text-generated-speech', hidden({
  purpose: '让后端按图文课程正文生成语音（生成语音弹窗的「识别文字」分支）。',
  whenToUse: '用户选了「识别文字」并确认播报人时用它。要按识别出来的图片文字生成用 study-course-text-generate-speech；要挂自己上传的音频用 study-course-text-generate-speech-by-voice。',
  effect: 'write',
  inputs: {
    newsId: remoteIdInput('**远端图文资源 id**（弹窗的 `id` prop 来自列表行的 `record.news.id`），不是课程行 id。', 'study-course-text-list.list[].news.id'),
    type: parameter('生成类型；1 识别文字、2 识别图片、3 上传语音。**与课程列表的 type（1/2/4）不是同一组取值**。', '弹窗「生成类型」单选项', { type: '1 | 2 | 3', options: [{ value: 1, label: '识别文字' }, { value: 2, label: '识别图片' }, { value: 3, label: '上传语音' }], constraints: ['SDK 校验：只能是 1/2/3 之一，其它值在发请求前抛错'] }),
    voiceName: parameter('播报人；取自 study-course-text-voice-list 的 `value`。', 'study-course-text-voice-list[].value', { type: 'string', constraints: ['非空'] }),
  },
  output: speechOutput,
  consume: [...SPEECH_ASYNC_FACTS, '请求是 **GET**、参数在 query 上，键序为 `id`、`type`、`voiceName`（与页面逐字一致）；不要改成 POST。', '正文由后端从文章内容里取（`Tools.html2text`），SDK 不传正文；正文为空时后端返回 `code:300 没有文本内容！`。'],
  steps: [
    {
      role: 'required',
      when: '请求成功或超时',
      capabilityId: 'study-course-text-list',
      instruction: '用同一篇图文（同一 news.id）回查 `news.voiceState`：2 生成中、0 成功、1 失败。仍是 2 就继续等，不要重复提交。',
    },
    {
      role: 'optional',
      when: '用户改用另一种生成方式',
      capabilityId: 'study-course-text-generate-speech-by-voice',
      instruction: '换分支前不需要"取消"：本能力没有服务端撤销接口，已提交的生成无法回滚，只能等它跑完或直接覆盖 voiceUrl。',
    },
  ],
  completion: '回查 `news.voiceState` 到达终态（0 成功 / 1 失败）后才能报告生成结果；接口返回 200 只代表已受理。',
  idempotency: '端点没有 requestId，而且是 **GET 却真的写**：每次调用都会 `addNews`、把 `voiceState` 置 2、并再提交一个生成线程（`NewsLayController:376-386`）。超时后先回查 voiceState，未确认前不得重发。',
  boundaries: [
    '`write: true` 是按**真实行为**标的，不是按 HTTP 方法：这个方法名是 GET，但会写库并启动外部 TTS 任务。',
    '没有服务端撤销：生成开始后无法回滚，只能等结果或用另一个分支覆盖。',
  ],
  failures: [
    '`code:300`「操作失败」= news 不存在；`code:300`「没有文本内容！」= 正文为空；`code:402`「操作失败」= `addNews` 返回 0。三者都会抛成 `PortalApiError`，消息里带后端的中文原文。',
    'TTS 侧的失败**不在这个请求里**：接口早已返回 200，真实失败只体现在回查到的 `voiceState=1`。',
  ],
}))

add('study-course-text-generate-speech', hidden({
  purpose: '按「识别图片」得到的文字，为图文课程生成语音（生成语音弹窗的识别图片分支）。',
  whenToUse: '用户选「识别图片」、勾选图片并拿到识别结果后确认时用它。正文来源不同是它与 study-course-text-generated-speech 的唯一区别；两者的写库与异步生成副作用相同。',
  effect: 'write',
  inputs: {
    newsId: remoteIdInput('**远端图文资源 id**（`record.news.id`），不是课程行 id。', 'study-course-text-list.list[].news.id'),
    voiceName: parameter('播报人；取自 study-course-text-voice-list 的 `value`。', 'study-course-text-voice-list[].value', { type: 'string', constraints: ['非空'] }),
    content: parameter('识别出来的文字；**非空**，会作为要合成的正文。', '弹窗「识别结果」文本框（由图片识别步骤填入，用户可改）', { type: 'string', constraints: ['非空、去首尾空白后非空', '后端会先做 html2text 再判断，纯空白等价于空'] }),
  },
  output: speechOutput,
  consume: [...SPEECH_ASYNC_FACTS, '请求是 **POST**、JSON body 键序为 `id`、`voiceName`、`content`（与页面逐字一致）。', '副作用比「识别文字」分支多一项：识别出的文字会写进 `news.imageToCharacters`，下次打开弹窗时作为默认值回填。'],
  steps: [
    {
      role: 'required',
      when: '请求成功或超时',
      capabilityId: 'study-course-text-list',
      instruction: '回查同一篇图文的 `news.voiceState`，等它到达 0 或 1；同时可核对 `news.imageToCharacters` 是否等于提交的 content。',
    },
    {
      role: 'optional',
      when: '用户还没拿到识别结果',
      instruction: '「识别图片」这一步用的是另一条接口（`POST /admin-api/ai/chat/image_base_chat`，SSE 文本），**本次没有做成能力**；调用方需自行取得文字后再调本能力，或改用「识别文字」分支。',
    },
  ],
  completion: '回查 `news.voiceState` 到达终态后才能报告生成结果；接口返回 200 只代表已受理。',
  idempotency: '端点没有 requestId；重复提交会重复 `addNews`、重置 `voiceState=2` 并再提交一个生成线程。超时先回查，未确认前不得重发。',
  failures: [
    '`code:300 没有文本内容！`（content 经 html2text 后为空）、`code:300 操作失败`（news 不存在）、`code:402 操作失败`（addNews 返回 0）都会抛成 `PortalApiError`。',
    '图片识别那一步的失败不在这里：识别是前端调的另一条接口，失败信息不会出现在本能力的返回里。',
  ],
}))

add('study-course-text-generate-speech-by-voice', hidden({
  purpose: '把已上传的音频地址记到图文课程上（生成语音弹窗的「上传语音」分支）。',
  whenToUse: '用户自己录/传了一段音频、已经拿到 OSS 地址时用它。它与另外两个分支**副作用不同**：这里不合成、不启动生成线程，只是把地址写进文章。',
  effect: 'write',
  inputs: {
    newsId: remoteIdInput('**远端图文资源 id**（`record.news.id`），不是课程行 id。', 'study-course-text-list.list[].news.id'),
    voiceUrl: parameter('已上传的音频地址。', '调用方自己上传 OSS 后的返回地址（页面来自 common-upload-dragger 的 `audioInfo.url`）', { type: 'string', constraints: ['非空', 'SDK 不校验协议/后缀/大小；页面上传组件限制 mp3 且 ≤10MB，那是上传侧的事'] }),
  },
  output: speechOutput,
  consume: [
    '成功返回 `undefined`，响应是 `R.ok(200,"操作完成")`，没有业务 data。**这一条不是异步生成**：后端只把 `voiceState` 置 0、`generateVoiceMethod` 置 3、`voiceUrl` 写成传入值（`NewsLayController:456-470`）。',
    '请求是 **POST**、JSON body 键序为 `id`、`voiceUrl`。',
    '音频的字节传输不在本能力范围：页面用 OSS 直传组件，SDK 不做上传，只登记结果地址。',
    '回查 `study-course-text-list` 的 `news.voiceUrl` 与 `news.voiceState=0` 确认写入。',
  ],
  steps: [
    {
      role: 'required',
      when: '请求成功或超时',
      capabilityId: 'study-course-text-list',
      instruction: '回查同一篇图文的 `news.voiceUrl` 是否等于提交值、`news.voiceState` 是否已回到 0，再报告完成。',
    },
  ],
  completion: '回查 `news.voiceUrl` 等于提交地址且 `voiceState=0` 后才能报告完成。',
  idempotency: '端点没有 requestId，但这一条**是幂等的**：同样入参重复提交得到同样的三列值。即便如此，超时后仍应先回查再决定是否重发。',
  failures: [
    '`code:300 操作失败`（news 不存在）会抛成 `PortalApiError`；`voiceUrl` 为空在 SDK 侧就抛错，不发请求。',
    '这一条不校验音频是否真的能播放：写出一个失效地址也会返回成功，播放失败要等用户试听才发现。',
  ],
}))

add('study-course-video-type-tree', hidden({
  purpose: '取视频课程编辑页的「类别」下拉候选。',
  whenToUse: '用户在视频课程编辑表单里选分类时用它。它与本批的视频标签候选（study-course-video-tag-list）不是一回事：类别是单选且成树，标签是多选的名字列表。',
  effect: 'read',
  inputs: {
    // 这个参数在能力定义里是 `required: false`（SDK 自己钉死它），说明里也必须写 false，
    // 否则 `pnpm ai:check:complete` 会报 input-required-mismatch。
    type: optional(
      '分类树的口径：固定为 1 —— 页面的原话是"新建或者修改的时候需要的下拉框，需要去掉有子分类的"。**SDK 不接受调用方改写**：传别的值也不会生效。',
      'SDK 固定值',
      'SDK 固定发送 1，不读取调用方的值',
      { type: 'integer', default: 'SDK 固定 1', options: [{ value: 1, label: '新建/修改时的下拉' }] },
    ),
  },
  output: arrayOutput('视频分类候选', [
    field('[].title', 'string | null', '分类名称；页面下拉的 label。', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].type', 'number | null', '分类标识；页面下拉的 **value**，保存视频课程时提交的就是它。', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].id', 'number | null', '分类记录 id。**不是提交值**（提交的是 type）。', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].parentType', 'number | null', '父分类标识。', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].status', 'string | number | null', '启用状态原值。', { nullable: true, nullMeaning: '后端未返回' }),
  ], '返回 `[]` 表示当前没有可选分类；不是权限判定。业务数据在响应体的 `videoTypes` 键上，缺这个键时抛错。'),
  consume: [
    '用 `[].title` 展示、把选中项的 `[].type` 作为类别值；不要用 `[].id`（页面的 value 绑的是 type）。',
    '页面用 `v-model` 直接绑在表单的 `type` 字段上，所以提交的确实是这里的 type。',
    '只发了 `type=1`：后端另有一个 `videoHotTopicFlag` 入参（默认 0）页面没传，SDK 也不传 —— 传了会拿到与页面不同的分类集合。',
  ],
  steps: [],
  completion: '返回新建/修改场景下的分类候选；读取本身不修改任何数据。保存视频课程的动作不在本能力范围（见 boundaries）。',
  idempotency: null,
  boundaries: [
    '视频课程的**保存**（`POST/PUT /study/course/studycourse`）本次没有做成能力：它会跨到远端内容平台建资源并涉及 OSS 上传与分片，与本批"弹窗候选"的范围不同。',
    '返回值里是否带 `child` 子树、页面下拉是否只用扁平一层，没有实测；本契约只声明页面真正消费的 title / type 等字段。',
  ],
}))

add('study-course-video-professor-list', hidden({
  purpose: '取挂在某条视频上的讲师列表，供列表页「查看讲师」弹窗展示。',
  whenToUse: '用户从视频课程列表点「查看讲师」时用它。要讲师候选（用于挑选）请用讲师管理页的能力；这一条只回"这条视频已经关联了谁"。',
  effect: 'read',
  inputs: {
    mediaId: remoteIdInput('**远端视频资源 id**（列表行的 `videos.id`），不是课程行 id。', 'study-course-video-list.list[].videos.id'),
  },
  output: arrayOutput('视频讲师', [
    field('[].id', 'number | null', '讲师 ID。页面「讲师ID」列。', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].name', 'string | null', '讲师姓名。页面「讲师姓名」列。', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].level', 'number | null', '讲师等级；页面用 `portal-education-label-teacher-level` 组件按它渲染中文名，**不是**拿返回里的 `levelName`。', { nullable: true, nullMeaning: '后端未返回' }),
    field('[].levelName', 'string | null', '级别中文名（后端 JOIN 出来时才有）。页面不读它，SDK 也不把它作为展示依据 —— 要中文名请用 study-course-im-owner-level-options 按 level 匹配。', { nullable: true, nullMeaning: '当前这一路 SQL 没有 JOIN 级别表，通常为空' }),
  ], '返回 `[]` 表示这条视频没有关联讲师（或关联记录已失效）；不是权限判定，也不代表视频不存在。响应不是数组时抛错。'),
  consume: [
    '按页面三列展示 id / name / level；`level` 要显示中文名时用 study-course-im-owner-level-options 按 level 相等匹配。',
    '接口的第二个入参 `type` 页面固定传 0（`mp.type = 0`，即视频这一路）；原代码里 `record.videos.type` 那行是**注释掉的**，按项目规则不作为页面行为。SDK 不接受调用方改写它。',
    '没有分页：一条视频的关联讲师通常只有几个，整表返回。',
  ],
  steps: [],
  completion: '返回该视频关联的讲师列表；读取本身不修改任何数据。',
  idempotency: null,
  boundaries: [
    '只覆盖「查看讲师」这一个只读弹窗；视频课程编辑页里"改讲师"要经过保存链路，本次没有做成能力。',
  ],
}))

add('study-course-video-tag-list', hidden({
  purpose: '取视频课程编辑页的标签候选（标签名字符串列表）。',
  whenToUse: '用户在视频课程编辑表单里挑标签时用它。图文课程编辑页的标签走的是**另一个接口**（`/tag/list.lay?typeList=1`，返回 `{id,name}` 对象、选中值存 id），不在本能力范围内。',
  effect: 'read',
  inputs: {
    // 同 study-course-video-type-tree：能力定义里是 `required: false`，说明必须一致
    type: optional(
      '标签口径：固定为 21（视频课程标签）。**SDK 不接受调用方改写** —— 换成别的 type 就是另一类标签，不属于这一页。',
      'SDK 固定值',
      'SDK 固定发送 21，不读取调用方的值',
      { type: 'integer', default: 'SDK 固定 21', options: [{ value: 21, label: '课程标签' }] },
    ),
  },
  output: {
    shape: 'string[]',
    fields: [
      field('$', 'string[]', '标签名数组。**元素是字符串本身，不是对象** —— 这条接口的 `data` 就是 `select content from zhdj_label …`。'),
      field('[]', 'string', '一个标签名。页面把它直接渲染成可选按钮，选中后 join 成逗号串。'),
    ],
    empty: '返回 `[]` 表示 `type=21` 下没有标签；不是权限判定。业务数据在响应体的 `data` 键上，缺这个键或元素不是字符串时抛错。',
  },
  consume: [
    '把标签名直接展示给用户多选；页面把选中的名字用英文逗号 `join` 成一个字符串（`tagNames`）交给表单的 `tag` 字段。',
    '顺序即后端 `ORDER BY order_num` 的顺序，页面按这个顺序渲染按钮，不要重排。',
    '本能力只给候选，**不负责保存**：视频课程的保存链路本次没有做成能力，标签要落到课程上必须走页面或后续补的写能力。',
    '后端还有一个 `label` 拼写的同类接口（`/label/list.lay`）与图文页那个 `/tag/list.lay`，都不是这一条；URL 里的 `lable` 是原文拼写，不要"修正"成 `label`。',
  ],
  steps: [],
  completion: '返回可选标签名供用户多选；读取本身不修改任何数据。',
  idempotency: null,
  boundaries: [
    '只覆盖视频课程编辑页的标签候选。图文课程编辑页用的是另一个同名组件（`text-course/components/tag.vue`）打 `/tag/list.lay?typeList=1`，本次没有做成能力。',
    '页面上「选中标签 → 保存课程」的写链路不在本能力范围。',
  ],
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
