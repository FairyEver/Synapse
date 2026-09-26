import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { platformSystemEmailCapabilities } from '../capabilities/platform-system-email.js'

const definitions = new Map(platformSystemEmailCapabilities.map(definition => [definition.id, definition]))

const field = (path: string, type: string, meaning: string): AiField => ({
  path,
  type,
  meaning,
  optional: true,
  nullable: true,
})

const array = (fields: AiField[], empty = '[] 表示本次查询没有记录；这是数组，不读取 list/total。'): AiContract['output'] => ({
  shape: 'object[]',
  fields: fields.map(item => ({ ...item, path: `[].${item.path}` })),
  empty,
})

const object = (fields: AiField[], empty = '字段缺省或为 null 时按空值处理，不把空值猜成默认业务值。'): AiContract['output'] => ({
  shape: 'object',
  fields,
  empty,
})

const scalar = (type: string, meaning: string): AiContract['output'] => ({
  shape: type,
  fields: [field('$', type, meaning)],
  empty: '返回值本身就是本次读取结果；空字符串仍按空字符串消费，不自行改成 null。',
})

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [],
  empty: '成功没有业务返回值；写入后必须调用对应读取能力核实服务端状态。',
}

const liveGaps = [
  '本轮已核对 Portal 页面源码、Java Controller/DTO、SDK 实现和离线请求断言；尚未在真实测试环境执行该页面的浏览器读操作。',
  '本轮未在真实环境执行写操作的 prepare → submit → cancel/回滚记录；该页面没有 Portal 可达的撤销接口，写入结果需部署环境冒烟后再移除该缺口。',
]

function typeOf (kind: string): string {
  if (kind === 'number') return 'number'
  if (kind === 'boolean') return 'boolean'
  return 'string'
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Platform system email contract has no definition: ${id}`)
  return Object.fromEntries(definition.params.map(parameter => {
    const input: AiParameter = {
      type: typeOf(parameter.kind),
      required: parameter.required,
      meaning: parameter.description ?? parameter.name,
      source: '用户给出的 Portal 邮件短信页面条件或表单；类型、必填性和提交投影按能力参数契约填写。',
    }
    if (parameter.options) input.options = parameter.options
    return [parameter.name, input]
  }))
}

const objectInput = (meaning: string): AiParameter => ({
  type: 'object',
  required: true,
  meaning,
  source: 'Portal 页面读取或编辑后的对象；SDK 会在发请求前执行页面同等的结构校验和字段投影。',
})

const stringInput = (meaning: string, required = true): AiParameter => ({
  type: 'string',
  required,
  meaning,
  source: '按 Portal 页面真实请求参数传入；不把空字符串和省略参数混用。',
})

const contracts: Record<string, AiContract> = {}

function add (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Platform system email contract has no capability: ${id}`)
  contracts[id] = {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只操作当前 Portal 用户、当前租户和 /dashboard/platform-v2/system/email 权限范围内的邮件短信配置；请求使用 platform 实例和 /mall-manage-api 前缀。',
      '该页面不发送 module-type；列表是数组而不是分页对象，保存渠道选择时会按页面顺序压缩为后端 setAccount 所需的 list。',
    ],
    effect: definition.write ? 'write' : 'read',
    prerequisites: ['使用会话 token 和租户创建 SDK；写入前先读取页面当前状态，确认 action、模板 type 或账号目标。'],
    output,
    consume,
    steps: [],
    completion: '返回值符合本能力结构；写入能力还必须按说明中的对应读取能力核对最终状态。',
    failures: [
      '参数校验失败时按页面规则修正；模板标题和内容为空、短信签名为空都会在请求前失败。',
      '权限、会话或后端业务校验失败按原错误处理；写请求超时先读取当前状态，不能盲目重复提交。',
    ],
    idempotency: null,
    evidence: [
      { source: 'src/capabilities/platform-system-email.ts', kind: 'implementation', note: '核对平台实例、无 module-type、数组列表、渠道 compact 顺序、模板 varMap omit、短信签名请求头和表单校验。' },
      { source: 'test/platform-system-email.test.ts', kind: 'test', note: '离线锁定 Portal 页面实际请求方法、参数、提交体、权限和必填负例。' },
      { source: 'docs/pages/邮件短信.md', kind: 'reference', note: '记录 Portal 页面动作、Java DTO 字段和实测/推断边界。' },
    ],
    gaps: [...liveGaps],
    ...extra,
    inputs: { ...inputsOf(id), ...extra.inputs },
  }
}

const channelFields = [
  field('name', 'string | null', '模板名称或展示名称'),
  field('project', 'string | null', '模板所属项目'),
  field('active', 'number | null', '模板是否有效的服务端标记'),
  field('title', 'string | null', '邮件标题或模板标题'),
  field('content', 'string | null', '模板正文内容'),
  field('count', 'string | null', '模板计数信息原值'),
  field('time', 'string | null', '模板时间信息原值'),
  field('isChoose', 'number | null', '列表渠道是否选中；1 表示保存时纳入 multiType，0 表示不纳入'),
  field('type', 'string | null', '后端模板渠道类型；保存时原样放入 multiType'),
]

const rowFields = [
  field('project', 'string', '项目标识'),
  field('action', 'string', '消息动作标识；编辑模板和保存渠道时作为目标键'),
  field('mail', 'object | null', '邮件模板渠道；null 表示该动作没有邮件模板'),
  ...channelFields.map(item => ({ ...item, path: `mail.${item.path}` })),
  field('sms', 'object | null', '短信模板渠道；null 表示该动作没有短信模板'),
  ...channelFields.map(item => ({ ...item, path: `sms.${item.path}` })),
  field('msgPush', 'object | null', '消息推送模板渠道；null 表示该动作没有推送模板'),
  ...channelFields.map(item => ({ ...item, path: `msgPush.${item.path}` })),
  field('smsSetting', 'object | null', '短信设置展示对象；列表返回原值，底部渠道保存不会读取它'),
]

const payloadFields = [
  field('payload', 'object', '页面最终提交的请求体'),
  field('payload.list', 'object[]', '有至少一个渠道 isChoose=1 的行；无选中渠道的行被页面 compact 丢弃'),
  field('payload.list[].multiType', 'string', '按 mail、sms、msgPush 顺序拼接选中模板 type，以逗号连接'),
  field('payload.list[].tmplAction', 'string', '对应列表行 action'),
]

const templatePayloadFields = [
  field('payload', 'object', '编辑模板的最终请求体；不包含只读 varMap'),
  field('payload.title', 'string', '模板标题；页面必填'),
  field('payload.content', 'string', '模板正文；页面必填'),
  field('payload.action', 'string', '模板动作；来自读取详情的 action'),
  field('payload.type', 'string', '模板渠道类型；来自路由 query.type'),
  field('payload.isEnable', 'number', '启用状态原值'),
  field('payload.label', 'string | null', '模板名称/标签，按回显值提交'),
]

add('platform-system-email-list', '读取邮件短信渠道配置列表。', array(rowFields), ['逐行读取 action、mail、sms、msgPush 和 isChoose；列表数组没有 total。'])
add('platform-system-email-prepare-set-account', '按页面顺序计算底部保存的邮件短信渠道请求体，不发请求。', object(payloadFields), ['把 payload 交给 platform-system-email-set-account；prepare 成功只表示本地校验通过。'], { effect: 'prepare', inputs: { rows: objectInput('邮件短信列表当前行数组；保留页面返回的 action、mail、sms、msgPush 及各渠道 type/isChoose。') } })
add('platform-system-email-set-account', '保存列表中各消息动作启用的邮件、短信和消息推送渠道。', voidOutput, ['成功或超时后重新 list，按每个 action 对照各渠道 isChoose；没有选中渠道的行不会出现在提交 list 中。'], {
  idempotency: '后端没有 requestId 或撤销接口；超时必须先 list 核对每个 action 的渠道状态，再决定是否重试。',
  inputs: { rows: objectInput('邮件短信列表当前行数组；SDK按 mail→sms→msgPush 顺序读取 isChoose=1 的 type，并复刻页面 compact。') },
  steps: [{ capabilityId: 'platform-system-email-list', role: 'required', when: '保存响应成功或不确定时', instruction: '重新读取列表，逐个 action 核对 mail、sms、msgPush 的最终选中状态。', mapping: {} }],
})
add('platform-system-email-maintain-template', '初始化缺失的邮件短信模板和基础配置。', voidOutput, ['成功或超时后调用 list；需要编辑具体模板时再按 action/type 调用 get-template。'], {
  idempotency: '后端按缺失模板初始化；没有 requestId 或撤销接口，超时先 list/get-template 核对是否已补齐。',
  steps: [{ capabilityId: 'platform-system-email-list', role: 'required', when: '初始化响应成功或不确定时', instruction: '重新读取列表，确认模板行和渠道状态已可供页面使用。', mapping: {} }],
})
add('platform-system-email-get-sms-signature', '读取短信签名设置或列表预览使用的短信签名。', scalar('string', '短信签名配置字符串'), ['设置页读取时省略 smsSign；列表预览时传 smsSign=""，不能把这两种请求混为一谈。'])
add('platform-system-email-prepare-save-sms-signature', '按页面必填规则准备短信签名保存体，不发请求。', object([field('payload', 'string', '待提交的短信签名字符串')]), ['把 payload 交给 platform-system-email-save-sms-signature；空字符串不能提交。'], { effect: 'prepare', inputs: { smsSign: stringInput('短信签名；页面 Form.Item required，必须为非空字符串。') } })
add('platform-system-email-save-sms-signature', '保存短信签名设置。', voidOutput, ['成功或超时后调用 get-sms-signature（设置页读取方式，不传 smsSign）核对服务端签名。'], {
  idempotency: '后端保存没有 requestId 或撤销接口；超时先 get-sms-signature 核对最终字符串，再决定是否重试。',
  inputs: { smsSign: stringInput('短信签名；页面 Form.Item required，SDK按 application/json;charset=UTF-8 以 JSON 字符串原样提交。') },
  steps: [{ capabilityId: 'platform-system-email-get-sms-signature', role: 'required', when: '保存响应成功或不确定时', instruction: '不传 smsSign 重新读取设置，逐字符核对最终短信签名。', mapping: {} }],
})

const accountFields = [
  field('smtpPassword', 'string | null', 'SMTP 密码'),
  field('smtpPort', 'string | null', 'SMTP 端口'),
  field('smtpServer', 'string | null', 'SMTP 服务器地址'),
  field('smtpUserName', 'string | null', 'SMTP 用户名'),
  field('userMail', 'string | null', '发件邮箱'),
]
add('platform-system-email-get-email-account', '读取邮件账号设置。', object(accountFields), ['按 SMTP 服务器、端口、用户名、发件邮箱和密码字段消费；页面不自动补默认值。'])
add('platform-system-email-prepare-save-email-account', '准备保存邮件账号设置，不发请求。', object([field('payload', 'object', '页面表单展开后的邮件账号请求体'), ...accountFields.map(item => ({ ...item, path: `payload.${item.path}` }))]), ['把 payload 交给 platform-system-email-save-email-account；页面不做额外必填校验。'], { effect: 'prepare', inputs: { account: objectInput('邮件账号表单对象；页面直接展开整个表单提交，不擅自删除未知字段。') } })
add('platform-system-email-save-email-account', '保存邮件账号设置。', voidOutput, ['成功或超时后调用 get-email-account，逐字段核对最终账号配置。'], {
  idempotency: '后端保存没有 requestId 或撤销接口；超时先 get-email-account 核对最终字段，再决定是否重试。',
  inputs: { account: objectInput('邮件账号表单对象；页面直接展开整个表单，SDK保留未知字段并按已知字段校验字符串/null。') },
  steps: [{ capabilityId: 'platform-system-email-get-email-account', role: 'required', when: '保存响应成功或不确定时', instruction: '重新读取邮件账号，逐字段核对服务端最终值。', mapping: {} }],
})

const templateFields = [
  field('content', 'string | null', '模板正文；编辑提交时页面要求非空'),
  field('title', 'string | null', '模板标题；编辑提交时页面要求非空'),
  field('action', 'string', '模板动作'),
  field('type', 'string', '模板渠道类型，例如 email、sms、app'),
  field('varMap', 'string | null', '页面展示的变量说明；编辑提交时会 omit，不发送给后端'),
  field('isEnable', 'number', '模板启用状态原值'),
  field('label', 'string | null', '模板名称/标签'),
]
add('platform-system-email-get-template', '按列表 action 和编辑渠道 type 读取模板详情。', object(templateFields), ['先消费 action/type 确认目标，再以 content/title/varMap 生成页面可编辑表单；不要把 varMap 当作保存字段。'], {
  inputs: {
    action: stringInput('模板动作；来自列表行 action。'),
    type: { ...stringInput('模板渠道类型；来自编辑入口路由 query.type。'), options: [{ value: 'email', label: '邮件' }, { value: 'sms', label: '短信' }, { value: 'app', label: '应用/推送' }] },
  },
})
add('platform-system-email-prepare-update-template', '按页面必填规则准备模板编辑请求体，不发请求。', object(templatePayloadFields), ['把 payload 交给 platform-system-email-update-template；varMap 只用于展示，不在 payload 中。'], { effect: 'prepare', inputs: { form: objectInput('get-template 回显后修改的模板表单；title/content/action/type 必须非空，isEnable 必须为整数，varMap不会提交。') } })
add('platform-system-email-update-template', '保存指定邮件短信模板的标题、正文和启用状态。', voidOutput, ['成功或超时后按原 action/type 调用 get-template，逐字段核对 title、content、isEnable 和 label；不要把保存解释成发送或审批。'], {
  idempotency: '后端模板保存没有 requestId 或撤销接口；超时先 get-template 核对最终内容，再决定是否重试。',
  inputs: { form: objectInput('get-template 回显后修改的模板表单；页面提交时 omit varMap，并要求 title/content 非空。') },
  steps: [{ capabilityId: 'platform-system-email-get-template', role: 'required', when: '保存响应成功或不确定时', instruction: '用保存请求中的 form.action 和 form.type 重新读取模板，逐字段核对最终状态。', mapping: {} }],
})

export const PLATFORM_SYSTEM_EMAIL_AI_CONTRACTS = contracts
