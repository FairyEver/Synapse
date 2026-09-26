import { ALL_CAPABILITY_DEFINITIONS } from '../capabilities/index.js'
import { CHAT_METHODS } from '../capabilities/chat.js'
import type { AiContract, AiField, AiParameter } from './ai-contract.js'

const definitions = new Map(ALL_CAPABILITY_DEFINITIONS.map(definition => [definition.id, definition]))

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  ...extra,
})

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning,
  source,
  ...extra,
})

const portalEvidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main@acab69acc77b6d6c0da21310cdfd26b91a01641e：app/portal/views/dashboard/common/chat/components/ChatConversation.vue、common/chat/api.js、common/chat/utils/attachments.js',
    kind: 'reference',
    note: '核对智能助手入口、请求路径、SSE/FormData顺序、技能排序、附件限制、反馈路径和页面消费字段。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test@0f1a55718ebc1987affb8bf245106e809dd51da4：AiPCChatController、AiSkillOrderController、AiQuestionInfoController、AiQuestionDTO、AiModelAvailableDTO、AiSkillOrderRespVO',
    kind: 'reference',
    note: '核对认证/权限注解、DTO字段、技能顺序校验、SSE服务端协议及反馈接口方法冲突。',
  },
  {
    source: 'src/capabilities/chat.ts、test/chat.test.ts、test/chat-http-compat.test.ts',
    kind: 'test',
    note: '锁定SDK对外返回、FormData字段顺序、附件边界、SSE心跳/终止和原始反馈URL参数。',
  },
]

const failures = [
  '401/凭据失效、权限不足、网络错误或标准响应失败都抛异常；不能把空数据解释为无权限或成功。',
  '字段、ID、分页或附件本地校验失败时不发请求；服务端业务错误按原错误返回，先修正输入或核对上下文。',
]

function inputsOf (id: string, overrides: Record<string, AiParameter> = {}): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`缺少智能助手能力定义：${id}`)
  const result: Record<string, AiParameter> = {}
  for (const item of definition.params) {
    result[item.name] = param(
      item.description ?? item.name,
      `Portal智能助手${item.name}参数；按页面源码原值填写，不能从其他页面猜测。`,
      {
        type: item.kind === 'number' ? 'number' : item.kind === 'boolean' ? 'boolean' : 'string',
        required: item.required,
        ...(item.options ? { options: item.options } : {}),
      },
    )
  }
  return { ...result, ...overrides }
}

function base (id: string, purpose: string, output: AiContract['output'], extra: Partial<AiContract> = {}): AiContract {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`缺少智能助手能力定义：${id}`)
  return {
    purpose,
    whenToUse: purpose,
    effect: definition.write ? 'write' : 'read',
    boundaries: [
      '能力归属Portal一级菜单“智能助手”，页面权限码为/dashboard/chat；不把聊天返回的目标路由或侧栏页面误当成本能力自身的页面入口。',
      '返回字段只解释Portal页面实际消费和后续动作所需的数据；后端未被页面消费的扩展字段可透传，但不能据此推断额外业务能力。',
    ],
    prerequisites: ['使用同一长期复用的SDK会话和同一Portal用户/租户凭据；写入前确认用户的明确意图。'],
    inputs: inputsOf(id),
    output,
    consume: ['保留返回中的ID、状态和原始空值语义；需要下一步时只按契约中的来源映射调用，不用名称或数组下标替代ID。'],
    steps: [],
    completion: definition.write ? '得到接口成功回执或流式终止事件；写入是否达到页面目标按契约要求核实。' : '得到当前用户可见的页面数据并交付；不自动触发写操作。',
    failures,
    idempotency: definition.write
      ? 'Portal没有为此写操作提供SDK级requestId防重；超时或流中断时先按契约回查，不盲目重复提交。'
      : null,
    evidence: portalEvidence,
    ...extra,
  }
}

const availableFields: AiField[] = [
  field('id', 'number | string | null', '调用配置ID；可能为空，不能替代model.id或skill.id', { nullable: true, nullMeaning: '当前调用类型没有独立配置ID或后端未返回' }),
  field('callType', 'number | null', '调用类型；智能助手页面请求固定为2', { nullable: true, values: { '2': 'Web智能助手' }, nullMeaning: '后端未返回' }),
  field('callTypeName', 'string | null', '调用类型显示名称，原样展示', { nullable: true, nullMeaning: '后端未返回' }),
  field('skillIdList', 'Array<number | string>', '当前可用技能ID集合；技能对象仍以skills为准'),
  field('skills', 'object[]', '当前可选技能及页面展示/发送所需信息'),
  field('skills[].id', 'number | string', '技能ID；选择技能时填chat-stream.skillId'),
  field('skills[].name', 'string | null', '技能展示名称', { nullable: true, nullMeaning: '后端未返回名称' }),
  field('skills[].icon', 'string | null', '技能图标地址', { nullable: true, nullMeaning: '无图标或未返回' }),
  field('skills[].tipPromptText', 'string | null', '技能提示文本候选；页面可能归一为发送前的prompt', { nullable: true, nullMeaning: '未提供' }),
  field('skills[].promptText', 'string | null', '兼容技能提示文本字段', { optional: true, nullable: true, nullMeaning: '未提供' }),
  field('skills[].prompt', 'string | null', 'SDK兼容归一后的提示文本；不把它当成服务端已执行结果', { optional: true, nullable: true, nullMeaning: '未归一或未提供' }),
  field('models', 'object[]', '当前可选模型配置；页面用其id选择未绑定技能的模型'),
  field('models[].id', 'number | string', '模型配置ID；未选技能时填chat-stream.modelConfigId'),
  field('models[].modelName', 'string | null', '模型展示名称', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
  field('models[].description', 'string | null', '模型描述', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
  field('models[].availableStatus', 'number | null', '模型可用状态；页面只应选择当前可用模型', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
  field('models[].supportedFiles', 'string | null', '支持文件类型原值；Portal没有据此增加聊天SDK的额外白名单', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
  field('models[].supportImgNum', 'number | null', '模型支持的图片数量原值', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
]

const historyFields: AiField[] = [
  field('list', 'object[]', '当前页历史对话；不是全部历史'),
  field('list[]', 'object', '一条历史问答记录'),
  field('list[].id', 'number | string', '历史回答ID；反馈时填chat-feedback.id'),
  field('list[].question', 'string | null', '用户最终发送的问题文本', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].answer', 'string | null', '回答文本；与contentItems可能同时存在', { nullable: true, nullMeaning: '流式回答尚未形成文本或后端未返回' }),
  field('list[].contentItems', 'object[] | null', '结构化回答内容项；按数组顺序展示，不把它拼成无损纯文本', { nullable: true, nullMeaning: '该记录没有结构化内容' }),
  field('list[].fileInfo', 'string | object[] | null', '历史附件描述/预览信息；保持服务端原始结构', { nullable: true, nullMeaning: '该问答没有附件或后端未返回' }),
  field('list[].useful', 'number | null', '有用性状态：1有用、0无用；null表示未评价', { nullable: true, values: { '0': '无用', '1': '有用' }, nullMeaning: '尚未评价或后端未返回' }),
  field('list[].createTime', 'string | null', '历史记录创建时间；原样展示，不自行换算时区', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].router', 'string | null', '回答动作/目标路由信息', { optional: true, nullable: true, nullMeaning: '该回答没有路由动作' }),
  field('list[].pcRouter', 'string | null', 'PC端回答动作路由', { optional: true, nullable: true, nullMeaning: '该回答没有PC路由动作' }),
  field('list[].routerParameter', 'object | null', '路由动作参数；只能交给目标页面权限守卫继续判断', { optional: true, nullable: true, nullMeaning: '该回答没有路由参数' }),
  field('total', 'number', '当前用户/会话查询条件下的历史总数，不是当前页长度'),
]

const streamFields: AiField[] = [
  field('[]', 'object', 'SSE流中的一条事件；SDK过滤heartbeat但保留普通事件和错误事件'),
  field('[].ret', 'string | null', '事件业务结果标记；原样交给调用方', { optional: true, nullable: true, nullMeaning: '事件未返回该标记' }),
  field('[].code', 'number | null', '事件业务码；原样交给调用方', { optional: true, nullable: true, nullMeaning: '事件未返回业务码' }),
  field('[].msg', 'string | null', '流错误/提示文本；Portal将非空msg视为错误并结束当前读取', { optional: true, nullable: true, nullMeaning: '事件没有提示文本' }),
  field('[].errorMsg', 'string | null', '流错误文本；优先于普通内容处理', { optional: true, nullable: true, nullMeaning: '事件没有错误文本' }),
  field('[].data', 'object | null', 'SSE业务数据；heartbeat事件不向调用方产出', { nullable: true, nullMeaning: '错误事件或无业务数据' }),
  field('[].data.type', 'string | null', '特殊事件类型；heartbeat由SDK过滤', { optional: true, nullable: true, nullMeaning: '普通业务事件' }),
  field('[].data.id', 'number | string | null', '最终历史回答ID；出现非空值表示Portal会结束读取并可用于反馈', { optional: true, nullable: true, nullMeaning: '回答尚未结束或事件是中间增量' }),
  field('[].data.answer', 'string | null', '回答文本增量/最终回答；与contentItems并存时按contentItems消费规则处理', { optional: true, nullable: true, nullMeaning: '本事件没有文本' }),
  field('[].data.contentItems', 'object[] | null', '结构化回答增量；页面按事件追加/替换展示内容', { optional: true, nullable: true, nullMeaning: '本事件没有结构化内容' }),
  field('[].data.useful', 'number | null', '回答评价状态：1有用、0无用；用于初始化页面点赞/点踩', { optional: true, nullable: true, values: { '0': '无用', '1': '有用' }, nullMeaning: '本事件未返回评价状态' }),
  field('[].data.router', 'string | null', '服务端动作路由；需结合pcRouter/routerParameter消费', { optional: true, nullable: true, nullMeaning: '没有动作' }),
  field('[].data.pcRouter', 'string | null', 'PC端可达动作路由；目标页面仍有自己的权限守卫', { optional: true, nullable: true, nullMeaning: '没有PC动作' }),
  field('[].data.routerParameter', 'object | null', '动作路由参数；不能把它当成SDK可直接执行的任意URL', { optional: true, nullable: true, nullMeaning: '没有动作参数' }),
  field('[].data.url', 'string | null', '卡片/文件或动作关联URL；原样保存，不自动下载', { optional: true, nullable: true, nullMeaning: '没有URL' }),
  field('[].data.agentData', 'object | array | string | null', '智能体卡片数据；结构由卡片类型决定，未声明字段不做业务推断', { optional: true, nullable: true, nullMeaning: '没有智能体扩展数据' }),
  field('[].data.info', 'object | array | string | null', '页面卡片信息扩展；保持原值', { optional: true, nullable: true, nullMeaning: '没有扩展信息' }),
  field('[].data.agentType', 'number | string | null', '智能体类型或卡片分支标识', { optional: true, nullable: true, nullMeaning: '普通文本回答或未返回' }),
  field('[].data.cardNo', 'number | string | null', '页面卡片编号；不等同于历史记录ID', { optional: true, nullable: true, nullMeaning: '没有卡片' }),
  field('[].data.cardName', 'string | null', '卡片名称', { optional: true, nullable: true, nullMeaning: '没有卡片名称' }),
  field('[].data.cardTemplateNo', 'number | string | null', '卡片模板编号', { optional: true, nullable: true, nullMeaning: '没有模板编号' }),
  field('[].data.modelConfigId', 'number | string | null', '本次实际使用的模型配置ID', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
  field('[].data.usage', 'object | null', '模型用量扩展信息；页面未用作配额结算证明', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
]

const skillOrderFields: AiField[] = [
  field('skills', 'object[]', '当前用户显式选择的技能及其顺序；空数组可能表示跟随默认或没有可用技能'),
  field('skills[].id', 'number | string', '技能ID；保存时按当前顺序提交'),
  field('skills[].name', 'string | null', '技能名称', { nullable: true, nullMeaning: '后端未返回' }),
  field('defaultSkills', 'object[]', '管理员默认技能顺序；恢复默认时页面使用其顺序'),
  field('defaultSkills[].id', 'number | string', '默认技能ID'),
  field('displayCount', 'number', '后端返回的展示数量原值；Portal当前不直接消费它'),
  field('customized', 'boolean', '是否存在当前用户的自定义技能顺序'),
]

const contracts: Record<string, AiContract> = {}

contracts['chat-available-list'] = base('chat-available-list', '读取智能助手页面可选择的模型与技能候选。', {
  shape: '{ id, callType, callTypeName, skillIdList, skills, models }',
  fields: availableFields,
  empty: 'skills=[]且models=[]表示后端当前没有可用技能/模型配置；不要自行编造候选ID。',
}, {
  consume: ['以skills[].id填chat-stream.skillId并保留对应提示文本；未选技能时以models[].id填modelConfigId。', '页面请求callType=2；该接口后端标记PermitAll，但调用方仍应使用有效SDK会话以获得与Portal一致的请求头。'],
  steps: [
    { role: 'optional', when: '用户选择技能或模型后发送问题', capabilityId: 'chat-stream', mapping: { skillId: 'result.skills[].id', modelConfigId: 'result.models[].id' }, instruction: '选择技能时只映射skillId；若不选技能才映射modelConfigId，并把问题文本按页面规则整理后发送。' },
  ],
  completion: '已交付当前页面可选技能与模型；不代表模型调用已发生。',
})

contracts['chat-history'] = base('chat-history', '分页读取当前用户的智能助手历史对话。', {
  shape: '{ list: ChatHistoryItem[], total: number }',
  fields: historyFields,
  empty: 'list=[]且total=0表示当前分页范围没有历史记录；不能据此判断用户没有任何其他租户历史。',
}, {
  consume: ['list是当前页，按pageNo/pageSize继续翻页；保留list[].id作为反馈ID，保留contentItems用于结构化渲染。', '历史接口服务端按token解析用户；Java源码未见tenant_id过滤，不能向调用方承诺跨租户隔离已被后端实现。'],
  steps: [{ role: 'optional', when: '用户要评价某条历史回答', capabilityId: 'chat-feedback', mapping: { id: 'result.list[].id' }, instruction: '只对选中的历史回答询问用户是否有用，再传0或1；不要把question或requestId当反馈ID。' }],
  completion: '交付当前页历史和total；没有用户写入意图时到此结束。',
  gaps: ['未在真实环境验证历史分页、token用户范围和租户隔离；当前结论来自Portal/Java源码。'],
})

contracts['chat-stream'] = base('chat-stream', '提交智能助手问题并读取Portal同源SSE回答事件。', {
  shape: 'AsyncIterable<ChatStreamEvent>',
  fields: streamFields,
  empty: '自然EOF且没有非空[].data.id时表示没有得到Portal页面认可的最终回答；调用方必须按错误/未完成处理，不能报告成功。',
}, {
  inputs: inputsOf('chat-stream', {
    question: param('最终发送的问题文本；SDK先trim。页面在选择技能但文本为空时会先把技能prompt整理成最终问题，调用方应传入该最终文本。', 'chat-available-list返回skills[].prompt或用户明确提供的文本', { type: 'string', required: false, constraints: ['question、skillId、files至少提供一项；无文本且有文件时服务端按页面/后端规则总结文件。'] }),
    skillId: param('选中的技能ID；必须来自chat-available-list.skills[].id。选择技能后不发送modelConfigId。', 'chat-available-list.result.skills[].id', { type: 'number | string', required: false }),
    modelConfigId: param('未选择技能时使用的模型配置ID；有skillId时被Portal规则忽略。', 'chat-available-list.result.models[].id', { type: 'number | string', required: false }),
    intent: param('可选意图原值；页面非空才追加multipart字段。', '用户在页面意图选择卡片中确认的值', { type: 'string', required: false }),
    categoryIds: param('可选分类ID字符串；按Portal原值追加，不把逗号字符串自动改成数组。', '页面模块选择结果', { type: 'string', required: false }),
    moduleIds: param('可选模块ID字符串；按Portal原值追加。', '页面模块选择结果', { type: 'string', required: false }),
    imageIds: param('可选证件图片/图片URL ID字符串；按Portal原值追加，SDK不做OSS直传。', '页面图片上传动作的结果', { type: 'string', required: false }),
    agentOrchestration: param('智能体编排开关；省略时读取ai_agent_orchestration_status字典的is_open=1。', '用户明确指定，或SDK同一会话的baseData字典读取', { type: 'boolean', required: false, default: 'false' }),
    files: param('随chatStream同一个multipart请求上传的附件数组；不是OSS预上传对象。', '用户明确选择的File内容或等价{name,data}输入', { type: 'Array<ChatAttachment>', required: false, constraints: ['最多5个附件、最多1张图片；Portal未实现聊天专用大小白名单，服务端仍可能拒绝文件类型。'] }),
  }),
  boundaries: [
    '这是非幂等写入：每次提交都可能产生新的问答记录、文件对象和模型调用；前端requestId由页面生成但Java chatStream会重新解析，不能当SDK防重键。',
    'SSE事件中的router/pcRouter只描述Portal动作；SDK不执行window.open、iframe、卡片渲染、租户切换或任意URL，目标页面权限仍由目标页面处理。',
    'Portal会过滤heartbeat、遇到errorMsg/msg停止读取、遇到最终id结束读取；SDK返回普通事件/错误事件给调用方，由调用方按这些字段消费。',
  ],
  consume: ['先从chat-available-list选定skillId或modelConfigId；选技能时使用对应prompt组成最终question。', '逐事件追加answer/contentItems；保留带id的最终事件用于历史反馈；errorMsg/msg视为失败并停止业务处理。', '如果事件含pcRouter/routerParameter/url，只把它作为待用户确认的动作信息，不自动执行未登记的页面或侧栏动作。'],
  steps: [{ role: 'optional', when: '流返回非空最终id且用户要评价回答', capabilityId: 'chat-feedback', mapping: { id: 'result.[].data.id' }, instruction: '向用户确认有用/无用后提交0或1；流式提交本身不自动反馈。' }],
  completion: '收到最终事件id并能交付answer/contentItems，或明确交付流错误/自然EOF未完成；不能只凭HTTP请求发出报告成功。',
  gaps: ['未在真实环境验证multipart wire顺序、SSE分片边界、模型异常断流、文件类型限制及服务端实际权限；当前为Portal源码、Java源码和离线测试证据。'],
})

contracts['chat-feedback'] = base('chat-feedback', '提交智能助手回答的有用性评价。', {
  shape: 'void',
  fields: [],
  empty: '成功没有业务返回值；请求完成只表示SDK发出了反馈请求，不证明页面乐观状态与服务端最终状态一致。',
}, {
  inputs: inputsOf('chat-feedback', {
    id: param('历史回答主键；来自chat-history.list[].id或chat-stream事件[].data.id。', 'chat-history.result.list[].id 或 chat-stream.result.[].data.id', { type: 'number | string', required: true }),
    useful: param('评价值：1有用、0无用；Portal按钮将其映射为点赞/点踩。', '用户明确选择', { type: '0 | 1', required: true, options: [{ value: 0, label: '无用' }, { value: 1, label: '有用' }] }),
  }),
  boundaries: [
    '为复刻Portal原生fetch，SDK使用GET ai/updateUseful.json，并把会话token放入c查询参数、跳过platform GET的_t；该路径没有/admin-api前缀。',
    '固定Java控制器只声明POST，而Portal实际GET；SDK明确保留Portal GET兼容选择，不擅自改成无法复刻c字段注入的POST。若网关未提供GET兼容，该能力被外部路由阻塞。',
    'SDK检查原始业务响应的ret；HTTP 200但ret不是SUCCESS时仍抛出业务失败，不能把请求完成当成反馈已生效。',
    'Java控制器按id更新且未核验c与记录用户/租户归属；SDK不把它描述成跨用户安全隔离能力。',
  ],
  consume: ['保留id和useful原值发送；先检查业务ret，再根据SUCCESS或异常决定是否报告完成。', 'Portal按钮可能先乐观更新；出现网络错误、业务失败或结果不确定时重新读取历史核对useful。'],
  completion: '仅当HTTP请求返回且业务ret严格为SUCCESS时报告SDK调用完成；这仍不替代历史回查对服务端最终状态的独立确认。',
  failures: ['HTTP非2xx或请求异常：反馈结果不确定，保留异常并回查历史后再决定是否重试。', 'HTTP 200但响应ret不是SUCCESS：视为业务失败，保留msg，不得报告成功；修正参数或处理外部路由兼容后再重试。', 'Portal GET与固定Java POST不兼容且网关未提供兼容路由：能力不可交付，不能改报成功。'],
  gaps: ['未在真实环境验证网关是否暴露旧GET路径、Java POST映射是否由网关兼容，以及反馈是否按当前用户/租户隔离。', '固定Java代码在反馈记录不存在分支先写FAIL后又覆盖为SUCCESS；SDK无法凭该错误业务回执识别记录不存在，需后端修正或历史回查。'],
})

contracts['chat-skill-order'] = base('chat-skill-order', '读取智能助手当前用户技能展示集合、默认顺序和定制状态。', {
  shape: '{ skills: object[], defaultSkills: object[], displayCount: number, customized: boolean }',
  fields: skillOrderFields,
  empty: 'skills=[]可能表示用户跟随默认、技能全部下线或当前没有技能；结合customized/defaultSkills解释，不能直接报告为无权限。',
}, {
  consume: ['Portal用skills中的id作为当前用户勾选顺序，并用getAvailableList返回的技能对象补齐图标/prompt；defaultSkills和displayCount用于恢复默认/兼容解释。'],
  steps: [{ role: 'optional', when: '用户确认调整技能展示顺序或集合', capabilityId: 'chat-prepare-save-skill-order', mapping: { skillIds: 'result.skills[].id' }, instruction: '只提交用户确认的技能ID子集；页面最多保留8个且至少1个。' }],
  completion: '交付当前技能顺序状态；不改变用户配置。',
})

contracts['chat-prepare-save-skill-order'] = base('chat-prepare-save-skill-order', '在保存智能助手技能顺序前校验并生成无副作用草稿。', {
  shape: '{ skillIds: Array<number | string> }',
  fields: [field('$', 'object', '技能顺序草稿'), field('skillIds', 'Array<number | string>', '去重后的技能ID顺序；页面规则至少1个、最多8个')],
  empty: 'skillIds为空、重复、非正整数或超过8个时抛错，不发请求；恢复默认必须调用reset而不是提交空数组。',
}, {
  effect: 'local',
  idempotency: null,
  inputs: inputsOf('chat-prepare-save-skill-order', {
    skillIds: param('按页面展示顺序排列的技能ID数组；必须来自chat-available-list.skills[].id。', 'chat-available-list.result.skills[].id 或 chat-skill-order.result.skills[].id', { type: 'Array<number | string>', required: true, constraints: ['至少1个、最多8个、不能重复；8是Portal页面勾选上限，后端虽允许最多1000个不改变本页规则。'] }),
  }),
  consume: ['展示草稿供用户确认；确认后把同一个草稿传给chat-save-skill-order，取消只丢弃草稿。'],
  steps: [{ role: 'required', when: '用户确认保存当前技能子集', capabilityId: 'chat-save-skill-order', mapping: { skillIds: 'result.skillIds' }, instruction: '保存前再次确保用户已确认，成功后读取chat-skill-order核对实际顺序。' }],
  completion: '得到本地有效草稿；没有服务端副作用。',
})

contracts['chat-save-skill-order'] = base('chat-save-skill-order', '保存当前用户在智能助手页面勾选的技能及其展示顺序。', {
  shape: 'boolean',
  fields: [field('$', 'boolean', '服务端true成功回执；不等同于其他用户或默认顺序已改变')],
  empty: '服务端拒绝、技能已下线/列表变化、权限失败或非true回执都不能报告保存成功。',
}, {
  inputs: inputsOf('chat-save-skill-order', {
    skillIds: param('按页面展示顺序提交的技能ID子集；来自当前可用技能，不能为空、不能重复，页面最多8个。', 'chat-prepare-save-skill-order.result.skillIds 或最新chat-available-list.result.skills[].id', { type: 'Array<number | string>', required: true, constraints: ['Portal页面至少1个、最多8个；后端还会校验技能必须属于当前默认技能集合。'] }),
  }),
  consume: ['成功后调用chat-skill-order回查skills；错误码1009001005表示技能列表已变化，应重新读取候选和排序，不盲目重试旧数组。'],
  steps: [{ role: 'required', when: '请求成功或结果不确定', capabilityId: 'chat-skill-order', instruction: '重新读取同一用户的技能顺序，核对skills的ID顺序和customized状态。' }],
  completion: '同一用户同一租户的技能顺序回查等于用户确认的子集后报告保存完成；并发覆盖风险需如实说明。',
  idempotency: 'PUT是整份列表覆盖且没有requestId；相同数组重复提交通常收敛，但并发请求以后写覆盖先写，结果不确定时先skillOrder回查。',
})

contracts['chat-reset-skill-order'] = base('chat-reset-skill-order', '恢复当前用户智能助手技能顺序和展示数量到默认状态。', {
  shape: 'boolean',
  fields: [field('$', 'boolean', '服务端true成功回执；表示清除个人定制，不直接给出默认技能快照')],
  empty: '服务端非true或请求失败时不能报告恢复成功；空save不是reset的替代品。',
}, {
  consume: ['成功后调用chat-skill-order读取新的skills/defaultSkills/customized，确认customized=false或按返回状态解释。'],
  steps: [{ role: 'required', when: '请求成功或结果不确定', capabilityId: 'chat-skill-order', instruction: '回查同一用户默认顺序；不要把reset回执当成默认技能列表本身。' }],
  completion: '回查确认用户已回到默认跟随状态后报告恢复完成。',
  idempotency: 'PUT reset没有requestId；重复调用语义收敛，结果不确定时先读取skillOrder，不自动连续重放。',
})

contracts['chat-policy-preview'] = base('chat-policy-preview', '读取智能助手回答动作引用的制度文件详情，供页面政策预览使用。', {
  shape: '{ id?, name?, fileUrl?, type?, ...pagePolicyFields }',
  fields: [
    field('id', 'number | string', '制度文件ID；来自回答动作参数', { optional: true }),
    field('name', 'string | null', '制度文件名称', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
    field('fileUrl', 'string | null', '制度文件预览/下载地址；页面用它打开预览', { nullable: true, nullMeaning: '制度没有可预览文件或后端未返回' }),
    field('type', 'number | null', '制度资源类型；保持后端原值', { optional: true, nullable: true, nullMeaning: '后端未返回' }),
  ],
  empty: '没有fileUrl时页面无法打开制度文件；不能把无权限或空详情解释成成功预览。',
}, {
  consume: ['只在SSE事件明确给出制度ID且用户确认打开时调用；返回fileUrl交给宿主预览器，SDK不下载、渲染或绕过制度页面权限。'],
  gaps: ['侧栏/卡片动作的完整路由和制度预览真实运行时权限尚未在浏览器环境验证；此能力只覆盖Portal源码明确使用的制度详情请求。'],
})

export const CHAT_CONTRACTS = contracts
export const CHAT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(CHAT_METHODS).map(([capabilityId, method]) => [
    `chat.${method}`,
    {
      ...contracts[capabilityId]!,
      boundaries: [...contracts[capabilityId]!.boundaries, `直接方法入口为sdk.chat.${method}；仍需遵守该页面能力的输入、权限和回查规则。`],
    },
  ]),
)
