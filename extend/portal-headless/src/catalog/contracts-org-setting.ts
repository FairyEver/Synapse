import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { hrOrganizationSettingCapabilities } from '../capabilities/org-setting.js'

const capabilityById = new Map(hrOrganizationSettingCapabilities.map(definition => [definition.id, definition]))

const field = (path: string, type: string, meaning: string): AiField => ({
  path,
  type,
  meaning,
  optional: true,
  nullable: true,
})

const page = (fields: AiField[]): AiContract['output'] => ({
  shape: '{ list: object[], total: number }',
  fields: [
    field('list', 'object[]', '当前页记录；仅覆盖本次请求页码'),
    field('total', 'number', '符合筛选条件的总记录数，不是当前页条数'),
    ...fields.map(item => ({ ...item, path: `list[].${item.path}` })),
  ],
  empty: 'list=[] 表示当前页没有记录；total=0 表示筛选范围没有记录，不把空结果解释为没有权限。',
})

const array = (fields: AiField[]): AiContract['output'] => ({
  shape: 'object[]',
  fields: fields.map(item => ({ ...item, path: `[].${item.path}` })),
  empty: '[] 表示本次候选或明细查询没有条目；这是数组，不读取 list/total。',
})

const object = (fields: AiField[], empty = '字段缺省或为 null 时按空值处理，不把空值猜成 0 或空字符串。'): AiContract['output'] => ({
  shape: 'object', fields, empty,
})

const scalar = (type: string, meaning: string): AiContract['output'] => ({
  shape: type,
  fields: [field('$', type, meaning)],
  empty: '返回值本身就是本次检查结果；null 只按契约中的空值语义处理。',
})

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [],
  empty: '成功没有业务返回值；必须按后续读取或页面列表独立核实写入结果。',
}

const fileFields = [
  field('fileName', 'string', '下载文件名；由响应 URL 或页面固定名称推导'),
  field('contentType', 'string', '响应 Content-Type；缺省时使用页面对应的 Excel MIME'),
  field('base64', 'string', '文件二进制的标准 Base64 内容'),
  field('byteLength', 'number', '解码后的文件字节数；大于 0 才算下载成功'),
]

const liveGaps = [
  '本轮已核对 Portal 页面源码、Java 接口路径、SDK 实现和离线请求断言；尚未在真实测试环境执行该页面的浏览器读操作。',
  '本轮未在真实环境执行创建、编辑、启停、关系变更、导入等写操作的 prepare → submit → cancel/回滚记录；写入结果需部署环境冒烟后再移除该缺口。',
]

function typeOf (kind: string): string {
  if (kind === 'number') return 'number'
  if (kind === 'enum') return 'number | null'
  if (kind === 'date' || kind === 'search' || kind === 'text') return 'string'
  return 'string'
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = capabilityById.get(id)
  if (!definition) throw new Error(`Organization setting contract has no capability: ${id}`)
  return Object.fromEntries(definition.params.map(parameter => {
    const meaning = parameter.description ?? `组织设置页面的 ${parameter.name} 参数`
    const input: AiParameter = {
      type: typeOf(parameter.kind),
      required: parameter.required,
      meaning,
      source: '用户给出的组织设置业务条件；按该参数的类型、必填性和页面规则填写。',
    }
    if (parameter.options) input.options = parameter.options
    return [parameter.name, input]
  }))
}

const formInput = (meaning: string): AiParameter => ({
  type: 'object',
  required: true,
  meaning,
  source: '先读取详情或按 Portal 表单字段构造；SDK 会在请求前执行页面同等条件校验和提交字段投影。',
})

const idInput = (meaning: string): AiParameter => ({
  type: 'string | number',
  required: true,
  meaning,
  source: '来自组织设置列表、详情或对应候选能力的 id；长整数按原始字符串传递。',
})

const contracts: Record<string, AiContract> = {}

function add (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void {
  const definition = capabilityById.get(id)
  if (!definition) throw new Error(`Organization setting contract has no capability: ${id}`)
  contracts[id] = {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只操作当前 SDK 用户、当前租户和 Portal 页面允许的组织数据；permission 与 module-type=11 由 SDK 页面上下文绑定。',
      '组织树、人员和岗位是长选项；SDK 不提供无关键字的全量人员/岗位搜索，必须先缩小候选范围。',
    ],
    effect: definition.write ? 'write' : 'read',
    prerequisites: ['使用会话 token 和租户创建 SDK；写操作先确认目标组织及当前状态。'],
    output,
    consume,
    steps: [],
    completion: '返回值满足本能力的输出结构；写操作还必须按说明中的后续读取或列表核实终态。',
    failures: [
      '参数校验失败时按页面规则修正，不要绕过 SDK 校验直接拼请求。',
      '权限、会话或业务校验失败按原错误处理；写请求超时先读取当前状态，不能盲目换参数重试。',
    ],
    idempotency: null,
    evidence: [
      { source: 'src/capabilities/org-setting.ts', kind: 'implementation', note: '核对请求路径、参数装配、表单提交投影、响应归一化和状态保护。' },
      { source: 'test/org-setting.test.ts', kind: 'test', note: '离线锁定 Portal 默认参数、表单负例、omit 规则、敏感验证顺序和文件映射。' },
      { source: 'docs/pages/组织设置.md', kind: 'reference', note: '记录 Portal/Java 源码核对结果及实测与推断边界。' },
    ],
    gaps: [...liveGaps],
    ...extra,
    inputs: { ...inputsOf(id), ...extra.inputs },
  }
}

const listFields = [
  field('id', 'string | number', '组织主键；保留原始字符串避免长整数精度损失'),
  field('name', 'string', '组织名称'),
  field('code', 'string | null', '组织编码；null 表示后端未返回编码'),
  field('type', 'string | null', '组织类型名称'),
  field('level', 'number | null', '组织层级'),
  field('parentOrg', 'string | null', '上级组织名称'),
  field('director', 'string | null', '组织负责人展示名称'),
  field('foundDate', 'string | null', '成立日期文本'),
  field('isCorporation', 'number | null', '是否法人组织，0 否/1 是'),
  field('legalName', 'string | null', '法人名称'),
  field('mainInvest', 'string | null', '投资主体'),
  field('isStandardUnit', 'number | null', '是否标准化单元，0 否/1 是'),
  field('standardUnit', 'string | null', '标准单元'),
  field('standardLine', 'string | null', '标准线'),
  field('fullPath', 'string | null', '组织架构全路径'),
  field('containJob', 'string | null', '包含岗位展示文本'),
  field('createTime', 'string | number | null', '创建时间原值'),
  field('country', 'string | null', '所属国家'),
  field('address', 'string | null', '所属地区'),
  field('officeAddress', 'string | null', '办公地址'),
  field('remark', 'string | null', '备注'),
  field('status', 'number', '组织状态，0 停用/1 启用'),
]

const detailFields = [
  field('id', 'string | number', '组织主键'),
  field('name', 'string', '组织名称'),
  field('code', 'string | null', '组织编码'),
  field('typeList', '(string | number)[]', '组织类型 ID 数组'),
  field('propertyList', '(string | number)[]', '组织属性 ID 数组'),
  field('directorList', 'string | number | (string | number)[] | null', '负责人 ID 或负责人 ID 数组，保持页面回显形态'),
  field('pid', 'string | number', '上级组织 ID'),
  field('foundDate', 'string', '成立日期'),
  field('jobList', 'object[]', '组织岗位及编制数据'),
  field('partTimeJobList', 'object[]', '兼职岗位选择数据'),
  field('isCorporation', 'number', '是否法人组织，0 否/1 是'),
  field('corporation', 'string | number | null', '法人单位 ID'),
  field('hrLegalPersonDTO', 'object | null', '法人扩展信息；isCorporation=0 时提交会被省略'),
  field('hrOrganizationLicenseDTOList', 'object[]', '法人证照及数量；isCorporation=0 时提交会被省略'),
  field('isStandardUnit', 'number', '是否标准化单元，0 否/1 是'),
  field('standardUnit', 'string | null', '标准单元'),
  field('standardLine', 'string | null', '标准线'),
  field('isCostCenter', 'number', '是否成本中心，0 否/1 是'),
  field('costCenter', 'string | null', '成本中心编码'),
  field('remark', 'string | null', '备注'),
]

const formPayloadFields = [
  field('payload', 'object', '经过 Portal 表单校验和提交字段投影后的请求体'),
  field('payload.name', 'string', '组织名称；必填，最多 50 个字符'),
  field('payload.code', 'string | null', '组织编码；请求前转为大写'),
  field('payload.typeList', '(string | number)[]', '组织类型 ID 数组，至少一项'),
  field('payload.propertyList', '(string | number)[]', '组织属性 ID 数组'),
  field('payload.directorList', 'string | number | (string | number)[] | null', '规范化负责人 ID'),
  field('payload.pid', 'string | number', '上级组织 ID'),
  field('payload.foundDate', 'string', '成立日期'),
  field('payload.jobList', 'object[]', '岗位编制；内部岗位需要非负整数编制'),
  field('payload.partTimeJobList', 'object[]', '兼职岗位规范化为 [{ postId }]'),
  field('payload.isCorporation', 'number', '法人开关；为 1 时法人和证照字段必填'),
  field('payload.isStandardUnit', 'number', '标准化单元开关；为 1 时 standardUnit 与 standardLine 必填'),
  field('payload.isCostCenter', 'number', '成本中心开关；为 1 时 costCenter 必填'),
  field('payload.hrOrganizationLicenseDTOList', 'object[]', '法人证照数量；非法人组织提交时删除'),
]

add('hr-organization-setting-list', '按 Portal 组织设置列表筛选条件分页查询组织。', page(listFields), ['展示 list 中的组织字段；需要完整结果时继续按 pageNo 翻页至 total。'])
add('hr-organization-setting-detail', '读取一个组织的详情，用于编辑回显或写入后逐字段核实。', object(detailFields), ['保留详情中的服务端字段；编辑前不要只凭列表行重建完整表单。'])
add('hr-organization-setting-check-have-standard-unit', '检查指定上级组织是否存在标准化单元，用于页面条件提示。', scalar('boolean', '是否存在标准化单元；true 只表示检查结果，不会改变组织数据。'), ['true/false 都是成功的只读结果。'])
add('hr-organization-setting-prepare-create', '按 Portal 创建表单规则校验并生成实际创建请求体，不发请求。', object(formPayloadFields), ['把 output.payload 传给同一业务流程的 create；不要把 prepare 当作已创建。'], { effect: 'prepare', idempotency: null })
add('hr-organization-setting-create', '创建一个组织设置记录。', voidOutput, ['创建成功后用 list/detail 读取并核对名称、编码、上级组织、法人/标准化单元/成本中心条件字段。'], { idempotency: '没有后端 requestId；相同绝对值表单可能产生重复组织。请求超时必须先按完整名称、编码和上级组织查询核实，不能直接换参数重建。', steps: [{ capabilityId: 'hr-organization-setting-list', role: 'required', when: '创建响应成功或超时后', instruction: '查询列表并匹配完整名称、编码和上级组织，保存新组织 ID。' }] })
add('hr-organization-setting-prepare-update', '按 Portal 编辑表单规则校验详情回显对象并生成实际更新请求体，不发请求。', object(formPayloadFields), ['把 output.payload 传给同一业务流程的 update；该结果仍未写入服务端。'], { effect: 'prepare', idempotency: null })
add('hr-organization-setting-update', '编辑已有组织设置记录。', voidOutput, ['更新后调用 detail 逐字段核对；超时先读取当前详情再决定是否重试。'], { idempotency: '无后端 requestId；更新是绝对值提交。重试前先 detail，避免覆盖他人已经保存的新字段。', steps: [{ capabilityId: 'hr-organization-setting-detail', role: 'required', when: '更新响应成功或超时后', instruction: '读取目标组织详情，逐字段核对本次修改。' }] })
add('hr-organization-setting-check-can-disable', '停用前检查组织是否会触发业务限制或连带影响。', scalar('string | null', '非空字符串是 Portal 后端返回的阻断/提示信息；null 表示没有检查消息，不等于已经停用。'), ['把非空提示展示给用户；需要停用时仍要调用 disable。'])
add('hr-organization-setting-disable', '将当前启用的组织停用。', voidOutput, ['先执行 check-can-disable；成功后重新 list/detail 核对 status=0。'], { idempotency: '绝对状态写入，不是 toggle；重试前读取当前 status，只有仍为 1 才重发。', steps: [{ capabilityId: 'hr-organization-setting-check-can-disable', role: 'required', when: '每次停用前', instruction: '读取停用前检查结果并向用户说明限制或影响。' }] })
add('hr-organization-setting-enable', '将当前停用的组织启用。', voidOutput, ['成功后重新 list/detail 核对 status=1。'], { idempotency: '绝对状态写入，不是 toggle；重试前读取当前 status，只有仍为 0 才重发。' })
add('hr-organization-setting-prepare-change-relation', '读取组织隶属关系变更的敏感操作门控和脱敏手机号。', object([
  field('verificationRequired', 'boolean', '是否必须完成短信验证'),
  field('phone', 'string | null', '接收验证码的脱敏/配置手机号'),
  field('isDel', 'number | string | null', '敏感配置逻辑删除标记；数值 1 表示不要求验证'),
]), ['verificationRequired=true 时先 send-change-relation-code，再 verify-change-relation-code。'], { effect: 'prepare', idempotency: null })
add('hr-organization-setting-send-change-relation-code', '为需要敏感验证的组织关系变更发送短信验证码。', object([field('requestId', 'string', '本次短信请求 ID；verify 时原样传入')]), ['只在 prepare-change-relation 返回 verificationRequired=true 且有手机号时调用。'], { idempotency: '短信发送不是可安全盲重试的操作；响应缺少 requestId 时视为结果不确定，先确认短信状态，不自动重发。' })
add('hr-organization-setting-verify-change-relation-code', '验证组织关系变更短信验证码。', scalar('boolean', 'true 表示验证码校验成功；失败会抛出 Portal 返回的错误。'), ['只有返回 true 后才能调用 change-relation。'])
add('hr-organization-setting-change-relation', '按 Portal 敏感操作规则变更组织的上级关系。', voidOutput, ['免验证时直接提交；要求验证时完成 prepare、send、verify 后再提交；成功后重新 detail/list 核对 pid。'], { idempotency: '关系更新是绝对值写入；超时先读取目标组织 pid，只有未达到目标关系时才重试。', steps: [{ capabilityId: 'hr-organization-setting-prepare-change-relation', role: 'required', when: '每次变更关系前', instruction: '读取敏感验证门控。' }, { capabilityId: 'hr-organization-setting-verify-change-relation-code', role: 'recovery', when: 'prepare 要求短信验证时', instruction: '在提交关系变更前验证用户收到的验证码。' }] })
add('hr-organization-setting-export', '按当前组织筛选条件导出 Excel 文件。', object(fileFields), ['保存或传递 base64 文件；byteLength 必须大于 0，contentType 以响应为准。'])
add('hr-organization-setting-prepare-import', '在不上传的情况下校验组织岗位编制导入文件的 xlsx 扩展名、MIME 和 Base64。', object([
  field('fileName', 'string', '文件名，必须以 .xlsx 结尾'),
  field('contentType', 'string', '固定为 xlsx MIME'),
  field('byteLength', 'number', '解码后文件字节数，大于 0'),
]), ['校验通过后把同一文件输入传给 import；prepare 不会改变服务端数据。'], { effect: 'prepare', idempotency: null })
add('hr-organization-setting-import', '上传并导入组织岗位编制 xlsx 文件。', scalar('string | null', '后端导入回执文本；null 表示成功但没有业务回执。'), ['导入后重新 list/detail 检查组织岗位编制；不能把上传成功等同于每一行都导入成功。'], { idempotency: '导入可能部分成功且后端未提供 requestId；超时先读取目标组织的岗位编制，再决定是否重新上传，不能盲目重复导入。' })
add('hr-organization-setting-download-template', '下载指定组织的岗位编制模板或数据文件。', object(fileFields), ['保存或传递 base64 文件；先取得 Portal 返回的文件 URL，再下载二进制。'])
add('hr-organization-setting-history-list', '分页查询组织变更历史记录。', page([
  field('id', 'string | number', '变更记录主键'),
  field('orgId', 'string | number | null', '关联组织 ID'),
  field('orgName', 'string | null', '组织名称'),
  field('changeTypeDesc', 'string | null', '变更类型展示文本'),
  field('changeFieldCount', 'number | null', '变更字段数量'),
  field('changeTime', 'string | null', '变更时间'),
  field('operatorName', 'string | null', '操作人名称'),
]), ['从 list[].id 选择记录后调用 history-detail；日期筛选使用 YYYY-MM-DD HH:mm:ss。'])
add('hr-organization-setting-history-detail', '读取一条组织变更历史的字段级明细。', object([
  field('id', 'string | number', '变更记录主键'),
  field('orgId', 'string | number | null', '关联组织 ID'),
  field('orgName', 'string | null', '组织名称'),
  field('changeTypeDesc', 'string | null', '变更类型展示文本'),
  field('changeFieldCount', 'number | null', '变更字段数量'),
  field('changeTime', 'string | null', '变更时间'),
  field('operatorName', 'string | null', '操作人名称'),
  field('changeItems', 'object[]', '字段变更项'),
  field('changeItems[].field', 'string', '发生变化的字段名'),
  field('changeItems[].oldValue', 'string | null', '旧值文本'),
  field('changeItems[].newValue', 'string | null', '新值文本'),
  field('changeItems[].changeDesc', 'string | null', '字段变化说明'),
]), ['按 changeItems 逐项解释旧值和新值，不把缺省值猜成空字符串。'])
add('hr-organization-setting-part-time-posts', '查询当前组织下的兼职岗位汇总。', array([
  field('postId', 'string | number', '兼职岗位 ID'),
  field('postName', 'string | null', '岗位名称'),
  field('partTimeStaffCount', 'number | null', '兼职人员数'),
  field('existNumber', 'number | null', '已占用编制数'),
]), ['从 postId 选择兼职岗位或查看人员，再调用 part-time-staff-page。'])
add('hr-organization-setting-part-time-staff-page', '按兼职岗位分页查询人员关系。', page([
  field('relationId', 'string | number', '兼职关系主键'),
  field('name', 'string | null', '人员姓名'),
  field('staffCode', 'string | null', '员工编号'),
  field('organizationName', 'string | null', '人员所属组织'),
  field('postName', 'string | null', '兼职岗位名称'),
  field('status', 'string | number | null', '人员/关系状态原值'),
]), ['total 是当前组织和岗位筛选的总数；需要全量时继续翻页。'])
add('hr-organization-setting-organization-types', '加载 Portal 组织类型候选。', array([field('id', 'string | number', '组织类型 ID'), field('name', 'string', '组织类型名称')]), ['用户选择 name 后把对应 id 放入 typeList。'])
add('hr-organization-setting-organization-properties', '加载启用中的组织属性候选。', array([field('label', 'string', '属性显示名称'), field('value', 'string', '属性 ID 的字符串形式')]), ['把用户选择的 value 原样放入 propertyList；不要用 label 代替 ID。'])
add('hr-organization-setting-license-categories', '加载证照类型候选。', array([field('label', 'string', '证照名称'), field('typeId', 'string', '证照类型 ID 的字符串形式'), field('typeNum', 'null', '页面新增项的初始数量；提交时需填写非负整数')]), ['法人组织选择证照后填写 typeNum；非法人提交会省略证照列表。'])
add('hr-organization-setting-search-post-options', '按关键字分页搜索岗位候选，避免无头全量拉取长列表。', page([field('id', 'string | number', '岗位节点 ID'), field('name', 'string', '岗位名称')]), ['keyword 非空；从 list[].id 选择后可调用 post-node-details 补取完整节点。'])
add('hr-organization-setting-post-node-details', '根据已选岗位 ID 补取岗位节点详情。', array([field('id', 'string | number', '岗位节点 ID'), field('name', 'string', '岗位名称')]), ['ids 必须来自已选岗位或 search-post-options，不用名称猜 ID。'])
add('hr-organization-setting-search-users', '按关键字分页搜索组织负责人候选。', page([field('id', 'string | number', '用户 ID'), field('realName', 'string | undefined', '用户姓名'), field('username', 'string | undefined', '用户账号'), field('staffId', 'string | number | null | undefined', '员工 ID')]), ['keyword 非空；人员候选不能无关键字全量拉取。'])
add('hr-organization-setting-users-by-ids', '根据已选负责人 ID 补取人员候选。', array([field('id', 'string | number', '用户 ID'), field('realName', 'string | undefined', '用户姓名'), field('username', 'string | undefined', '用户账号'), field('staffId', 'string | number | null | undefined', '员工 ID')]), ['ids 必须来自已选用户或 search-users；返回数组可能为空。'])
add('hr-organization-setting-legal-persons', '加载组织表单使用的法人单位候选。', array([field('id', 'string | number', '法人单位 ID'), field('name', 'string', '法人单位名称'), field('superOrganizationName', 'string | null', '上级组织法人名称'), field('mainInvest', 'string | null', '投资主体')]), ['把候选 id 放入 corporation；不要把法人名称直接提交为 ID。'])
add('hr-organization-setting-cost-centers', '加载成本中心候选。', array([field('code', 'string', '成本中心编码'), field('name', 'string', '成本中心名称')]), ['把用户选中的 code 放入 costCenter；只在 isCostCenter=1 时提交。'])

const formOverrides: Record<string, string> = {
  'hr-organization-setting-prepare-create': '按 Portal 创建表单填写的组织对象；包含条件字段时必须满足对应开关规则。',
  'hr-organization-setting-create': '按 Portal 创建表单填写的组织对象；SDK 会规范化 code、负责人、兼职岗位和 omit 字段。',
  'hr-organization-setting-prepare-update': '详情回显后修改的完整组织对象；服务端字段不要丢失。',
  'hr-organization-setting-update': '详情回显后修改的完整组织对象；SDK 会保留页面提交需要的服务端字段并删除 UI-only 字段。',
}
for (const [id, meaning] of Object.entries(formOverrides)) contracts[id]!.inputs.form = formInput(meaning)
for (const id of ['hr-organization-setting-detail', 'hr-organization-setting-check-can-disable', 'hr-organization-setting-history-detail']) contracts[id]!.inputs.id = idInput(contracts[id]!.inputs.id!.meaning)
for (const id of ['hr-organization-setting-disable', 'hr-organization-setting-enable']) contracts[id]!.inputs.id = idInput(contracts[id]!.inputs.id!.meaning)
for (const id of ['hr-organization-setting-prepare-change-relation']) contracts[id]!.inputs = {}
for (const id of ['hr-organization-setting-post-node-details', 'hr-organization-setting-users-by-ids']) {
  contracts[id]!.inputs.ids = { type: '(string | number)[]', required: true, meaning: '已选节点/用户 ID 数组；长度受 SDK 保护。', source: '来自对应搜索能力返回的 list[].id；原样保留 ID 类型。' }
}
for (const id of ['hr-organization-setting-export', 'hr-organization-setting-list']) {
  contracts[id]!.inputs.status = { ...contracts[id]!.inputs.status!, type: 'number | null', meaning: '组织状态筛选；1 启用、0 停用、null 清除状态筛选。', source: '用户给出的状态筛选；1 启用、0 停用、null 清除状态筛选。' }
}
for (const id of ['hr-organization-setting-part-time-staff-page']) contracts[id]!.inputs.pageNo = { ...contracts[id]!.inputs.pageNo!, type: 'number', default: '1', meaning: '从 1 开始的页码；页面固定 pageSize=20。', source: '用户给出的页码；省略时使用页面默认 1。' }
for (const id of ['hr-organization-setting-search-post-options', 'hr-organization-setting-search-users']) {
  contracts[id]!.inputs.keyword = { ...contracts[id]!.inputs.keyword, type: 'string', required: true, meaning: '非空关键字；长选项不允许无关键字全量查询。', source: '用户先提供关键字；再从返回候选中选择具体 ID。' }
}
for (const id of ['hr-organization-setting-create', 'hr-organization-setting-update', 'hr-organization-setting-disable', 'hr-organization-setting-enable', 'hr-organization-setting-send-change-relation-code', 'hr-organization-setting-change-relation', 'hr-organization-setting-import']) {
  if (contracts[id]) contracts[id]!.idempotency = '写请求没有通用 requestId；按当前页面状态和返回值核实终态后再重试，避免重复或覆盖写入。'
}

export const HR_ORGANIZATION_SETTING_AI_CONTRACTS = contracts
