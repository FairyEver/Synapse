import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALARY_LEVEL_METHODS } from '../capabilities/salary-level.js'

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })

const idInput = param('薪资等级主键，不是员工 ID 或岗位 ID', 'salary-level-list 的 list[].id，由用户选择一条记录', {
  type: 'string | number', required: true,
  constraints: ['必须是正整数；SDK 规范化为字符串并保留长整数精度。'],
})
const idsInput = param('要删除的薪资等级主键数组；单条删除也传一个元素', 'salary-level-list 的 list[].id，由用户选择一条或多条记录', {
  type: 'array', required: true,
  constraints: ['不得为空；SDK 去重；数组元素必须是正整数 ID，不能传名称或员工 ID。'],
})
const idsItem = param('数组中的一个薪资等级 ID', '用户选中的 salary-level-list.list[].id', { type: 'string | number', required: true })
const draftInputs: Record<string, AiParameter> = {
  name: param('薪资等级名称，保存时保留用户输入的首尾空格', '用户输入；修改时先读取 salary-level-get.name', {
    type: 'string', required: true,
    constraints: ['不能为空或全为空格；最多 50 个字符；后端未删除记录中名称不可重复。'],
  }),
  sort: param('薪资等级在列表中的排序值', '用户输入；修改时先读取 salary-level-get.sort', {
    type: 'integer', required: true,
    constraints: ['非负整数；Portal 输入框不接受小数或负数。'],
  }),
  salaryStandard: param('该薪资等级对应的标准工资', '用户输入；修改时先读取 salary-level-get.salaryStandard', {
    type: 'number | string', required: true, unit: '元',
    constraints: ['非负金额，最多两位小数；字符串形式用于保留服务端十进制精度。'],
  }),
}

const rowFields = (prefix: string): AiField[] => {
  const at = (key: string) => prefix ? `${prefix}.${key}` : key
  return [
    field(at('id'), 'string | number', '薪资等级主键；详情、修改和删除使用，不是员工 ID'),
    field(at('name'), 'string', '薪资等级名称'),
    field(at('sort'), 'number | null', '列表排序值；非负整数', { nullable: true, nullMeaning: '服务端未返回排序值，不能据此推断排序位置' }),
    field(at('salaryStandard'), 'number | string | null', '标准工资，单位元；保留服务端数字或十进制字符串原值', { nullable: true, unit: '元', nullMeaning: '服务端未返回标准工资' }),
    field(at('status'), 'number | null', '服务端状态字段；本页面不把它解释成删除结果', { nullable: true, nullMeaning: '服务端未返回状态；不能自行映射为启用或停用' }),
    field(at('isDel'), 'number | null', '逻辑删除标记；0 为未删除，1 为已删除', { nullable: true, values: { '0': '未删除', '1': '已删除' }, nullMeaning: '服务端未返回删除标记' }),
  ]
}

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', '后端成功包络没有业务数据；SDK 不伪造新 ID、删除数量或布尔成功标志')],
  empty: 'Promise 正常完成表示请求成功；根值为 undefined，失败抛错。写入结果仍需通过独立查询核实。',
}

const evidence = [
  { source: 'app/portal/views/dashboard/hr/salary/salary-level/{list.vue,[mode]/[id].vue} @ 3622e02147', kind: 'reference' as const, note: '证明页面列表、创建/编辑表单、保存路径、表单校验和删除动作；未证明当前测试环境的实时部署差异。' },
  { source: 'app/portal/utils/hr/sensitive/useSensitiveAction.js 与 components/verify.vue @ 3622e02147', kind: 'reference' as const, note: '证明删除前 checkCanDelete、敏感配置、短信发送与验证码校验的调用顺序和 templateId=17709。' },
  { source: 'HrSalaryLevelController / HrSalaryLevelServiceImpl / HrSalaryLevelDTO @ c3348150f42', kind: 'reference' as const, note: '证明保存按 id 分新建/更新、名称重复校验、员工引用阻止删除和逻辑删除规则。' },
  { source: 'src/capabilities/salary-level.ts 与 test/salary-level.test.ts', kind: 'implementation' as const, note: '证明 SDK 最终请求形状、校验、删除重检查和离线回归夹具；不替代真实环境写操作证据。' },
]

const common = (effect: AiContract['effect'], purpose: string, inputs: Record<string, AiParameter>, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract => ({
  purpose,
  whenToUse: purpose,
  boundaries: [
    '只覆盖 Portal 人力管理 → 薪资等级页面及其编辑、删除确认链；不维护员工、岗位或薪资账套。',
    '请求使用当前会话用户、租户、platform 实例和页面 module-type=14；服务端权限与数据范围错误原样返回。',
    '当前证据来自固定 Portal/Java 源码和离线请求夹具，尚未完成真实测试环境浏览器基准及短信验证分支的线上记录。',
  ],
  effect,
  prerequisites: ['已创建带会话 token 和 tenantId 的 SDK；ID 来自当前用户可见的薪资等级记录。'],
  inputs,
  output,
  consume,
  steps: [],
  completion: '返回本能力声明的数据；写操作的业务完成仍以指定回查证实，不把 HTTP 成功或空回执当成最终状态。',
  failures: ['权限、登录、网络或后端业务错误原样抛出，不转换为空结果；写请求超时先按能力指定的查询核实，不盲目重发。'],
  idempotency: effect === 'write' ? '无 SDK 或后端 requestId 幂等保证；失败或超时先查询核实，不能把同名校验当作幂等回执。' : null,
  evidence,
  ...extra,
})

export const SALARY_LEVEL_AI_CONTRACTS: Record<string, AiContract> = {
  'salary-level-list': common('read', '分页查询当前用户可见且未删除的薪资等级，支持按名称模糊筛选。', {
    name: param('薪资等级名称包含筛选', '用户输入', { type: 'string', required: false, omitted: 'SDK 发空字符串，表示不按名称筛选' }),
    pageNo: param('页码，从 1 开始', '调用方分页状态', { type: 'integer', required: false, default: 'SDK 默认 1', constraints: ['必须为正整数'] }),
    pageSize: param('每页记录数', '调用方分页状态', { type: 'integer', required: false, default: 'SDK 默认 20', constraints: ['仅接受 Portal 页大小 10/20/50/100/200/500'] }),
    order: param('Portal 列表排序方向协议字段', '调用方排序状态', { type: 'string', required: false, omitted: 'SDK 发空字符串；页面未提供可改变排序的控件' }),
    orderField: param('Portal 列表排序字段协议字段', '调用方排序状态', { type: 'string', required: false, omitted: 'SDK 发空字符串；不要自行猜字段名' }),
  }, { shape: '{ list: object[], total: number }', fields: [field('$', 'object', '薪资等级分页结果'), field('list', 'object[]', '当前页记录'), field('list[]', 'object', '薪资等级记录；未列出的扩展字段不属于本页消费契约'), ...rowFields('list[]'), field('total', 'number', '符合名称筛选的总记录数，不是当前页条数')], empty: 'list=[] 表示当前页无记录；total=0 才表示筛选无结果；网络或权限失败抛错。' }, ['展示每条记录的 name、sort、salaryStandard；记录 id 供详情、修改或删除使用。', '累计已读取条数达到 total 后停止翻页；不要把一页误认为全量。'], {
    completion: '获得当前筛选页；需要全量时按 pageNo/pageSize 继续查询到 total，不对空页作权限判断。',
    steps: [{ role: 'optional', when: '用户要编辑或删除某条记录', capabilityId: 'salary-level-get', mapping: { id: 'user.selected.id' }, instruction: '先让用户明确选择一条薪资等级记录，使用其 id 读取当前值。' }],
  }),
  'salary-level-get': common('read', '读取一条薪资等级的当前编辑详情，供修改前确认完整表单值。', { id: idInput }, { shape: 'object | null', fields: [field('$', 'object | null', '薪资等级详情', { nullable: true, nullMeaning: '未找到记录，不能据此继续编辑' }), ...rowFields('')], empty: 'null 表示没有该详情；不要拿空对象或旧缓存代替当前值。' }, ['读取并保留 name、sort、salaryStandard 及 id；status/isDel 只作服务端原值参考，不自行改写。'], {
    completion: '获得当前薪资等级详情；尚未保存任何修改。',
    steps: [{ role: 'optional', when: '用户确认要修改该记录', capabilityId: 'salary-level-update', mapping: { id: 'result.id', name: 'result.name', sort: 'result.sort', salaryStandard: 'result.salaryStandard' }, instruction: '保留未修改字段并提交完整表单；不要把展示名称当成 id。' }],
  }),
  'salary-level-create': common('write', '创建一个薪资等级，保存名称、排序和标准工资。', draftInputs, voidOutput, ['成功无新建 ID；用名称查询并逐页精确核对 name、sort、salaryStandard，再取得新记录 id，不能按模糊结果第一条认领。'], {
    completion: 'Promise 完成仅表示保存请求成功；名称查询精确匹配并核对字段后，才能报告创建已核实。',
    steps: [{ role: 'required', when: '创建完成或请求超时需要核实', capabilityId: 'salary-level-list', mapping: { name: 'args.name' }, instruction: '按名称查询并逐页查找精确名称，核对 sort 与 salaryStandard；无记录或多条匹配都不能猜测结果。' }],
    failures: ['name 与已有未删除等级重复时，后端拒绝保存；更换名称或先核实现有记录，不把失败当成已创建。', '请求超时结果不确定；先按名称精确查询，确认没有记录后才由用户决定是否重试。'],
  }),
  'salary-level-update': common('write', '更新一条已有薪资等级的名称、排序和标准工资。', { id: idInput, ...draftInputs }, voidOutput, ['先 get 取得当前值，提交完整 name、sort、salaryStandard；不能只提交差异字段。'], {
    completion: '保存成功后 get 同一 id 并逐字段核对新值，才能报告修改已核实。',
    steps: [{ role: 'required', when: '更新完成或请求超时需要核实', capabilityId: 'salary-level-get', mapping: { id: 'args.id' }, instruction: '核对 name、sort、salaryStandard；不要把无异常返回当成已验证。' }],
    failures: ['名称与其他未删除等级重复时后端拒绝；保留当前 id，修改名称后重试。', '请求超时先 get 核实实际值，未核实前不要盲目覆盖重发。'],
  }),
  'salary-level-prepare-remove': common('prepare', '检查选中的薪资等级是否可删除，并读取本次敏感删除是否需要短信验证。', { ids: idsInput, 'ids[]': idsItem }, { shape: '{ ids: string[], verificationRequired: boolean, phone: string | null }', fields: [field('$', 'object', '删除前检查结果，不是删除回执或永久授权'), field('ids', 'string[]', '去重后的薪资等级 ID'), field('ids[]', 'string', '一个薪资等级 ID'), field('verificationRequired', 'boolean', 'true 表示本次删除需要短信验证；false 仅表示当前配置为空或 isDel 严格等于数值 1'), field('phone', 'string | null', '敏感配置中的 mobile 接收手机号；不是调用方可替换的号码', { nullable: true, nullMeaning: '没有配置手机号；需要验证时无法发送验证码' })], empty: 'ids 不能为空；被员工引用时请求抛出业务错误。准备检查不发送短信、不删除记录。' }, ['先处理 checkCanDelete 的占用错误，再根据 verificationRequired 决定是否发送验证码；不把本结果当成锁定或授权。'], {
    completion: '已取得本次删除条件；没有产生短信或删除副作用，remove 会重新执行占用和敏感配置检查。',
    steps: [{ role: 'required', when: 'verificationRequired=true 且用户明确要求发送验证码', capabilityId: 'salary-level-send-delete-code', mapping: { ids: 'result.ids' }, instruction: '只向当前敏感配置手机号发送，不另行指定接收人。' }, { role: 'optional', when: 'verificationRequired=false 且用户确认删除', capabilityId: 'salary-level-remove', mapping: { ids: 'result.ids' }, instruction: '传回完整的去重 ID 数组；remove 仍会重新检查。' }],
  }),
  'salary-level-send-delete-code': common('write', '向当前敏感操作配置手机号发送薪资等级删除验证码。', { ids: idsInput, 'ids[]': idsItem }, { shape: '{ smsRequestId: string }', fields: [field('$', 'object', '本次短信发送结果，不是删除结果'), field('smsRequestId', 'string', '服务端 requestId；用于本次 checkSms，不是幂等键或薪资等级 ID')], empty: '缺少 requestId 会抛错；短信可能已发送，SDK 不自动重发。' }, ['仅在用户明确要求发送验证码时调用；验证码必须由收件人提供，不能猜测或记录。'], {
    idempotency: '无 SDK 幂等包装；Portal 后端按手机号限制发送频率。超时可能已发送，先等待收件并核实，不立即重发。',
    completion: '取得本次短信 requestId；不表示短信已收到、验证已通过或记录已删除。',
    steps: [{ role: 'required', when: '用户提供本条短信验证码并确认删除', capabilityId: 'salary-level-remove', mapping: { ids: 'args.ids', smsRequestId: 'result.smsRequestId', code: 'user.code' }, instruction: 'code 必须来自本次短信；保留同批 ids 和本次 requestId，不混用旧验证码。' }],
    failures: ['敏感配置要求验证但没有手机号时拒绝发送；不能让调用方替换手机号绕过配置。', '发送响应缺少 requestId 时结果不确定；不要自动重发，先确认短信状态。'],
  }),
  'salary-level-remove': common('write', '经员工引用检查和必要短信验证后，逻辑删除一条或多条薪资等级。', { ids: idsInput, 'ids[]': idsItem, smsRequestId: param('本次删除验证码发送记录标识', 'salary-level-send-delete-code.smsRequestId', { type: 'string', required: false, requiredWhen: 'prepareRemove.verificationRequired=true', omitted: '当前配置不要求短信验证时省略' }), code: param('收件人收到的本次短信验证码', '用户提供，不可推测', { type: 'string', required: false, requiredWhen: 'prepareRemove.verificationRequired=true', omitted: '当前配置不要求短信验证时省略', constraints: ['不要记录到日志；不能使用其他批次验证码。'] }) }, voidOutput, ['SDK 每次重新调用 checkCanDelete 和敏感配置；需要验证时先 checkSms 成功，再发 DELETE JSON ID 数组。', '一个等级被员工引用会使整批删除失败；不要声称其它等级已经删除。'], {
    completion: '请求成功后按原名称分页查询，核对所选 ID 已不在未删除列表中；逻辑删除详情可能仍存在，不能只用 get 存在判断失败。',
    steps: [{ role: 'required', when: '删除返回或超时需要核实', capabilityId: 'salary-level-list', mapping: { name: 'user.recordNames' }, instruction: '按此前记录的名称逐页查询，核对每个所选 id 均不再出现在未删除列表；不能只看第一页。' }],
    failures: ['checkCanDelete 或 DELETE 报告“正在被使用”：整批不应视为完成，核实员工关联后再决定。', '缺验证码或验证码错误时 DELETE 尚未发出；取得当前有效验证码后重试，不改敏感配置绕过验证。', 'DELETE 超时结果不确定；先列表核实每个 ID，再决定是否重试。'],
  }),
}

export const SALARY_LEVEL_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALARY_LEVEL_METHODS).map(([capabilityId, method]) => [`salaryLevel.${method}`, { ...SALARY_LEVEL_AI_CONTRACTS[capabilityId]!, boundaries: [...SALARY_LEVEL_AI_CONTRACTS[capabilityId]!.boundaries, '直接方法签名为单个参数对象；键名与 inputs 一致，list 可省略参数对象。'] }]))
