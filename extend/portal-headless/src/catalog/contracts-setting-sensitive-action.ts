import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  SETTING_SENSITIVE_ACTION_METHODS,
  SETTING_SENSITIVE_ACTION_PAGE_PATH,
  SETTING_SENSITIVE_ACTION_PERMISSION,
  settingSensitiveActionCapabilities,
} from '../capabilities/setting-sensitive-action.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(settingSensitiveActionCapabilities.map(definition => [definition.id, definition]))

const settingsFields: AiField[] = [
  field('id', 'string | number', '当前敏感操作设置记录 ID；保存时原样作为 PUT body.id。', { source: 'Java HrSensitiveDTO.id' }),
  field('mobile', 'string | null', '敏感操作短信接收手机号；页面只展示脱敏值，但保存时按原值提交。', { nullable: true, nullMeaning: '没有配置手机号；当本次动作需要短信验证时不能发送验证码。' }),
  field('isDel', '0 | 1', '操作保护开关：0=开启保护，执行受保护动作时需要再次短信验证；1=关闭保护。', { values: { '0': '开启操作保护', '1': '关闭操作保护' } }),
]

const draftFields: AiField[] = [
  field('$', 'object', '尚未写入服务端的安全验证保存准备结果。'),
  field('draft', 'object', '确认后交给save的完整页面提交草稿。'),
  field('draft.id', 'string | number', '当前设置记录 ID；来自get，不是用户新建的ID。'),
  field('draft.isDel', '0 | 1', '目标保护开关：0开启、1关闭。', { values: { '0': '开启操作保护', '1': '关闭操作保护' } }),
  field('draft.mobile', 'string | null', '目标短信接收手机号；页面的PUT body只发送此字段，不发送email等DTO扩展字段。', { nullable: true, nullMeaning: '保存为空手机号；后续需要短信时无法发送。' }),
  field('previous', 'object', 'prepareSave使用的当前页面配置快照。'),
  field('previous.id', 'string | number', '准备时的设置记录 ID。'),
  field('previous.mobile', 'string | null', '准备时的旧短信接收手机号。', { nullable: true, nullMeaning: '准备时未配置手机号。' }),
  field('previous.isDel', '0 | 1', '准备时的旧保护开关。', { values: { '0': '开启操作保护', '1': '关闭操作保护' } }),
  field('verificationRequired', 'boolean', '本次页面动作是否需要先发送并校验短信：当前isDel不是1且关闭保护或提交了手机号修改意图时为true。'),
  field('phone', 'string | null', '验证码接收手机号，来自previous.mobile，不允许由调用方另换号码。', { nullable: true, nullMeaning: '没有接收手机号。' }),
  field('verificationReason', 'string', '触发短信的页面动作：none、disable-protection、change-phone或disable-protection-and-change-phone。', { values: { none: '不需要短信', 'disable-protection': '关闭操作保护', 'change-phone': '打开修改手机号并提交手机号', 'disable-protection-and-change-phone': '同时关闭保护并提交手机号修改' } }),
]

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '请求未抛错后的本地成功确认；Portal PUT没有页面消费的业务返回对象。')],
  empty: '权限、短信校验、网络或后端错误会抛出；true只代表PUT请求未抛错，必须再次get核对最终配置。',
}

const commonBoundaries = [
  `只覆盖Portal“系统设置 → 安全验证”页面${SETTING_SENSITIVE_ACTION_PAGE_PATH}；页面菜单权限是${SETTING_SENSITIVE_ACTION_PERMISSION}，不扩展到其他敏感词或其他安全设置页面。`,
  '页面列表请求使用platform HTTP实例；路径不命中Portal module-type规则，浏览器与SDK都不发送module-type。',
  '页面实际消费并提交的字段只有id、isDel、mobile；Java DTO中的email、creator、createTime、updater、updateTime不属于本页页面契约，SDK不把它们加入PUT body。',
  '页面没有按钮级permission指令；Java HrSensitiveController/Service源码也没有显式@PreAuthorize。仍需当前会话、tenant-id、Portal页面菜单权限及后端框架认证；菜单可见不等于绕过服务端拒绝。',
  'isDel=0表示开启操作保护，isDel=1表示关闭操作保护；Portal关闭保护和在保护开启时修改手机号都先走短信验证。',
  'prepareSave是SDK本地表单校验/草稿步骤，不对应Java prepare接口；取消只丢弃本地草稿。Java本页没有cancel、恢复或撤销接口。',
  '发送验证码使用固定templateId=17709和当前配置手机号；验证码requestId是短信记录标识，不是SDK幂等键。',
]

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/common.js、app/portal/views/dashboard/hr/setting/sensitive-action.vue、list.vue、components/change-phone.vue、app/portal/hooks/hr/useSensitiveAction.js、hooks/hr/components/verify.vue @ Portal test/portal/main acab69acc77b', kind: 'reference', note: '逐页证明菜单路径/页面权限、platform实例、初始表单字段、isDel=0/1语义、手机号必填与正则、短信验证触发条件、PUT body和保存后刷新。' },
  { source: 'HrSensitiveController、HrSensitiveDTO、HrSensitiveServiceImpl、HrSensitiveEntity @ Java test/test 0f1a55718ebc', kind: 'reference', note: '证明GET /org/sensitive/info、PUT /org/sensitive、DTO字段、按id通用update、最新id查询及控制器/服务未声明显式@PreAuthorize。' },
  { source: 'SendSmsController @ Java test/test 0f1a55718ebc', kind: 'reference', note: '证明GET /sys/sms/send使用固定hr-sensitive模板并返回requestId、GET /sys/sms/checkSms读取原始ret/msg、错误码402；短信发送一分钟限频。' },
  { source: 'src/capabilities/setting-sensitive-action.ts 与 test/setting-sensitive-action.test.ts', kind: 'implementation', note: '锁定最终请求、表单校验、保护开关/手机号短信前置、错误阻断和AI说明映射；不替代真实浏览器或测试环境证据。' },
]

const gaps = [
  '本工作单元未启动真实浏览器，也未在测试环境发送真实短信、输入真人验证码、保存并回读配置；离线夹具和源码锚点不能宣称线上写入成功。',
  'Java HrSensitiveServiceImpl未在本页源码中显式写tenant条件或权限注解，底层租户插件/网关行为未由本页静态证据单独证明；不能把菜单权限当成接口授权结论。',
  'Portal的60秒倒计时是UI行为，SDK不模拟定时器；后端短信缓存的精确过期时间和checkSms是否消费验证码未在本页控制器之外完成核对。',
]

const currentInput = param('最近一次get返回的完整页面配置；不要从Java DTO扩展字段拼造。', 'settingSensitiveAction.get.result', { type: 'object', required: true })
const changesInput = param('用户明确修改的页面字段；可只含isDel、只含mobile，或两者；省略表示保留当前值。', '用户在Portal页面上的操作意图', { type: 'object', required: false, nullable: true, omitted: '省略时prepareSave保留current的isDel和mobile' })
const preparationInput = param('prepareSave返回的完整准备结果；其中draft、previous、verificationRequired、phone和verificationReason必须保持一致。', 'settingSensitiveAction.prepareSave.result', { type: 'object', required: true })

const contracts: Record<string, AiContract> = {
  'setting-sensitive-action-get': {
    purpose: '读取Portal安全验证页面当前的保护开关、短信手机号和设置记录ID。',
    whenToUse: `进入${SETTING_SENSITIVE_ACTION_PAGE_PATH}或保存后需要核对页面最终状态时使用；不要用其他用户/租户缓存代替。`,
    boundaries: commonBoundaries,
    effect: 'read',
    prerequisites: ['使用当前Portal会话token、显式tenant-id和当前用户上下文。', `调用方应拥有页面菜单权限${SETTING_SENSITIVE_ACTION_PERMISSION}；服务端仍可能按会话/租户拒绝请求。`],
    inputs: {},
    output: { shape: 'object', fields: [field('$', 'object', '安全验证页面消费的配置对象。'), ...settingsFields], empty: '响应缺少对象、id或isDel时抛错；不能把空对象解释为关闭保护或没有权限。' },
    consume: ['读取isDel：0表示开启保护、1表示关闭保护；读取mobile只作为当前配置手机号和保存字段，不把脱敏展示值当作提交值。', '保存前把本次get结果交给prepareSave；保存后重新get并逐字段核对id、isDel、mobile。'],
    steps: [{ role: 'optional', when: '用户要编辑保护开关或点击修改手机号', capabilityId: 'setting-sensitive-action-prepare-save', mapping: { current: 'result.$' }, instruction: '把当前完整对象交给prepareSave，再根据verificationRequired决定是否发送短信。' }],
    completion: '交付当前页面实际消费的id、mobile、isDel；没有发起写请求。',
    failures: ['未登录、租户不匹配、页面权限不足、网络失败或响应缺字段都抛错；不能降级成默认isDel=1或空手机号。'],
    idempotency: null,
    evidence,
    gaps,
  },
  'setting-sensitive-action-prepare-save': {
    purpose: '按Portal安全验证表单和敏感操作触发规则准备一个尚未写入的保存草稿。',
    whenToUse: '用户已读取当前配置并明确选择开启/关闭保护或提交新手机号时使用。',
    boundaries: commonBoundaries,
    effect: 'prepare',
    prerequisites: ['current必须来自同一用户/租户最近一次get；changes只表达用户明确修改的字段。'],
    inputs: {
      current: currentInput,
      changes: changesInput,
      'changes.isDel': param('目标保护开关：0开启保护、1关闭保护；页面radio只产生这两个数值。', '用户点击Portal操作保护radio', { type: '0 | 1', required: false, options: [{ value: 0, label: '开启操作保护' }, { value: 1, label: '关闭操作保护' }] }),
      'changes.mobile': param('新手机号；对应Portal修改手机号弹窗的输入值。', '用户在change-phone.vue中输入并通过校验的手机号', { type: 'string', required: false, constraints: ['必填时必须匹配^1[3456789]\\d{9}$；不能传脱敏手机号。'] }),
    },
    output: { shape: '{ draft: object, previous: object, verificationRequired: boolean, phone: string | null, verificationReason: string }', fields: draftFields, empty: 'current缺少有效id/isDel、changes含未知字段或新手机号不通过页面校验时抛错，且不发请求。' },
    consume: ['向用户展示draft.isDel和draft.mobile的目标值；用户取消时丢弃整个准备结果，不调用短信或PUT。', 'verificationRequired=true时先调用sendVerificationCode；手机号只使用phone，不允许改成用户另填的号码。'],
    steps: [
      { role: 'required', when: '用户确认继续保存准备结果', capabilityId: 'setting-sensitive-action-save', mapping: { preparation: 'result.$' }, instruction: 'verificationRequired=false时可直接save；为true时必须先发送验证码并让收件人提供本次code。' },
      { role: 'optional', when: 'verificationRequired=true且用户明确要接收验证码', capabilityId: 'setting-sensitive-action-send-verification-code', mapping: { preparation: 'result.$' }, instruction: '只发送到result.phone；requestId只用于随后一次保存的短信校验，不是幂等键。' },
      { role: 'cancel', when: '用户在提交前取消修改', instruction: '丢弃draft；页面没有服务端cancel请求。' },
    ],
    completion: '得到尚未写入服务端的id/isDel/mobile草稿，以及是否需要短信和短信接收手机号。',
    failures: ['页面手机号为空、格式不匹配、isDel不是0/1、current不是当前配置或出现未登记字段时本地失败；不会发送任何网络请求。'],
    idempotency: null,
    evidence,
    gaps,
  },
  'setting-sensitive-action-send-verification-code': {
    purpose: '向当前安全验证配置的手机号发送本次关闭保护或手机号修改所需的短信验证码。',
    whenToUse: 'prepareSave返回verificationRequired=true且用户明确继续当前保存动作时使用。',
    boundaries: commonBoundaries,
    effect: 'write',
    prerequisites: ['必须持有同一份prepareSave结果且phone非空；验证码由手机号持有人接收，调用方不能自填或替换手机号。'],
    inputs: {
      preparation: preparationInput,
      'preparation.verificationRequired': param('是否真的需要短信；必须为prepareSave返回的true。', 'settingSensitiveAction.prepareSave.result.verificationRequired', { type: 'boolean', required: true, constraints: ['false时SDK拒绝发送，避免与Portal分支不一致。'] }),
      'preparation.phone': param('短信接收手机号；必须与prepareSave.previous.mobile一致。', 'settingSensitiveAction.prepareSave.result.phone', { type: 'string', required: true, constraints: ['不能替换为调用方另传手机号。'] }),
    },
    output: { shape: '{ requestId: string }', fields: [field('$', 'object', '短信发送结果。'), field('requestId', 'string', '服务端短信记录标识；用于save内部调用checkSms，不是写入幂等键。')], empty: '缺少requestId时抛错；发送结果可能已经发生，不能立即盲目重发。' },
    consume: ['保存requestId但不要记录短信验证码；等待真人提供本次短信code，再把同一preparation和verification交给save。', '后端按手机号一分钟限频；倒计时是Portal UI行为，SDK不以本地计时器替代后端回执。'],
    steps: [{ role: 'required', when: '手机号持有人提供本次验证码且用户仍确认保存同一草稿', capabilityId: 'setting-sensitive-action-save', mapping: { preparation: 'args.preparation', 'verification.requestId': 'result.requestId', 'verification.code': 'user.code' }, instruction: 'code只能来自本次短信；save会先调用checkSms，校验成功后才PUT。' }],
    completion: '得到本次短信发送记录requestId；不代表验证码已校验，也不代表配置已保存。',
    failures: ['当前草稿不需要短信、未配置手机号、后端一分钟限频、短信发送失败或响应缺requestId时失败；响应不确定时先等待/核实，不自动重发。'],
    idempotency: '没有SDK或后端幂等包装；短信接口按手机号限频，requestId不是幂等键。发送超时可能已经发出，先等待收件，不用新requestId连续重发。',
    evidence,
    gaps,
  },
  'setting-sensitive-action-save': {
    purpose: '按Portal安全验证页面的完整草稿保存保护开关和短信手机号。',
    whenToUse: '用户确认prepareSave结果后使用；这是本页唯一的配置写入动作。',
    boundaries: commonBoundaries,
    effect: 'write',
    prerequisites: ['preparation必须来自最近一次get→prepareSave；verificationRequired=true时必须提供本次sendVerificationCode得到的requestId和真人验证码。'],
    inputs: {
      preparation: preparationInput,
      'preparation.draft': param('prepareSave返回的完整id/isDel/mobile草稿；不能追加email或Java审计字段。', 'settingSensitiveAction.prepareSave.result.draft', { type: 'object', required: true }),
      verification: param('短信验证材料；只在verificationRequired=true时提供。', 'settingSensitiveAction.sendVerificationCode.result.requestId + 用户收到的短信code', { type: 'object', required: false, nullable: true, requiredWhen: 'preparation.verificationRequired=true', omitted: 'verificationRequired=false时省略；SDK不会调用checkSms。' }),
      'verification.requestId': param('本次短信发送记录标识。', 'settingSensitiveAction.sendVerificationCode.result.requestId', { type: 'string', required: false, requiredWhen: 'preparation.verificationRequired=true' }),
      'verification.code': param('本次短信实际收到的验证码。', '用户提供；不可猜测、不要写入日志或持久对话', { type: 'string', required: false, requiredWhen: 'preparation.verificationRequired=true' }),
    },
    output: trueOutput,
    consume: ['verificationRequired=true时，SDK先GET /sys/sms/checkSms并检查原始ret=SUCCESS；检查失败不会发送PUT。', 'PUT只发送{ id, isDel, mobile }；请求成功后必须重新get并逐字段核对，不把true解释成关闭保护已生效或手机号已可接收短信。'],
    steps: [
      { role: 'required', when: '保存请求成功或超时后需要确认最终状态', capabilityId: 'setting-sensitive-action-get', mapping: {}, instruction: '重新读取并核对同一id的isDel与mobile；超时结果不确定时先回查，不能盲目重复PUT。' },
      { role: 'cancel', when: '用户在PUT发送前取消', instruction: '丢弃preparation和verification，不调用save；PUT已发送后页面没有撤销接口。' },
    ],
    completion: 'PUT请求未抛错且get回查确认id、isDel、mobile达到目标值后，才报告配置保存已核实；不代表其它敏感操作都已执行。',
    failures: ['缺草稿、非法isDel/手机号或验证材料时本地失败，不发PUT；短信错误、权限/租户拒绝、网络错误或Java业务错误均失败。', 'PUT超时或回执丢失时终态不确定，先get核对；未核实前不要重复保存，避免覆盖并发修改。'],
    idempotency: '页面PUT没有requestId或后端幂等键；这是绝对值覆盖保存，同样payload通常收敛到同一终态，但超时可能已写入且会覆盖并发修改。先get回查再决定是否按最新配置重新prepare。',
    evidence,
    gaps,
  },
}

for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`安全验证契约没有对应能力定义：${id}`)

export const SETTING_SENSITIVE_ACTION_AI_CONTRACTS: Record<string, AiContract> = contracts
export const SETTING_SENSITIVE_ACTION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(SETTING_SENSITIVE_ACTION_METHODS).map(([id, method]) => [
    `settingSensitiveAction.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为settingSensitiveAction.${method}；本页写入遵循prepareSave→必要短信→save→get回查，取消只丢弃未提交草稿。`] },
  ]),
)
