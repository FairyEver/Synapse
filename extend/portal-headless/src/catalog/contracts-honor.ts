import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { HONOR_METHODS, honorCapabilities } from '../capabilities/honor.js'

const definitions = new Map(honorCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const rowFields: AiField[] = [
  field('id', 'string | number', '荣誉记录 ID；Long 可能序列化为字符串，编辑、删除和共享必须原样保留'),
  field('name', 'string | null', '荣誉名称', { nullable: true, nullMeaning: '后端未返回' }),
  field('awardedDate', 'string | null', '荣获日期，YYYY-MM-DD', { nullable: true, nullMeaning: '后端未返回' }),
  field('issuingAuthority', 'string | null', '颁发机构', { nullable: true, nullMeaning: '后端未返回' }),
  field('reportOrganizationId', 'string | number | null', '申报部门 ID', { nullable: true, nullMeaning: '未关联或后端未返回' }),
  field('reportOrganizationName', 'string | null', '申报部门名称；后端分页查询补充', { nullable: true, nullMeaning: '未补充' }),
  field('manageOrganizationId', 'string | number | null', '管理部门 ID', { nullable: true, nullMeaning: '未关联或后端未返回' }),
  field('manageOrganizationName', 'string | null', '管理部门名称；后端分页查询补充', { nullable: true, nullMeaning: '未补充' }),
  field('depositAddress', 'string | null', '荣誉附件或证书存放地点', { nullable: true, nullMeaning: '未填写' }),
  field('pdfUrl', 'string | null', 'PDF 附件 URL 逗号串；编辑准备时还原为数组', { nullable: true, nullMeaning: '无附件' }),
  field('pdfName', 'string | null', '与 pdfUrl 按顺序对应的 PDF 文件名逗号串', { nullable: true, nullMeaning: '无附件' }),
  field('isForever', '0 | 1 | null', '是否长期有效；1=是、0=否', { nullable: true, values: { '0': '否', '1': '是' } }),
  field('remindUser', 'string | null', '到期提醒人员 ID 逗号串；编辑准备时还原为 ID 数组', { nullable: true, nullMeaning: '未配置' }),
  field('organizationId', 'string | number | null', '所属组织 ID', { nullable: true, nullMeaning: '未关联或后端未返回' }),
  field('organizationName', 'string | null', '所属组织名称；后端分页查询补充', { nullable: true, nullMeaning: '未补充' }),
  field('endTime', 'string | null', '到期日期，YYYY-MM-DD；长期有效时通常为空', { nullable: true, nullMeaning: '长期有效或未返回' }),
  field('remindTime', 'number | null', '到期提醒提前月数；Portal 要求 1 至 99999 的整数', { nullable: true, nullMeaning: '未配置' }),
  field('status', 'number | null', '后端荣誉状态原值；页面未提供状态筛选或编辑', { nullable: true, nullMeaning: '后端未返回' }),
  field('remindUserName', 'string | null', '提醒人员名称摘要', { nullable: true, nullMeaning: '后端未补充' }),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页荣誉记录'), field('total', 'number', '符合筛选条件的总记录数，不是当前页长度'), ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[] 表示当前页没有记录；total=0 表示当前筛选没有记录。权限、会话、网络或响应形状错误会抛出，不降级为空页。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: rowFields,
  empty: '不存在、无权限或响应字段形状不符合 Portal 详情会抛错；SDK 不把缺失详情降级为空对象。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '后端 CommonResult<Boolean> 解包后的成功值 true')],
  empty: '没有 true 或请求抛错不能报告保存、删除或共享成功；写操作必须按 steps 回查。',
}

const preparationOutput = (label: string): AiContract['output'] => ({
  shape: '{ draft: object, previous?: object }',
  fields: [field('draft', 'object', `${label}已按 Portal 表单规则校验、尚未写入的完整草稿`), field('previous', 'object', '编辑前的表单快照；取消时只丢弃 draft，不调用写接口', { optional: true })],
  empty: '字段、ID、日期、附件数量或条件必填规则不符合 Portal 时在发请求前抛错。',
})

const shareOutput: AiContract['output'] = {
  shape: '{ organization: object[], post: object[], duty: object[], user: object[] }',
  fields: [
    field('organization', 'object[]', '共享组织成员；成员含 id，响应可能含 name/managerType'),
    field('post', 'object[]', '共享岗位成员；成员含 id，响应可能含 name/managerType'),
    field('duty', 'object[]', '共享职务成员；成员含 id，响应可能含 name/managerType'),
    field('user', 'object[]', '共享人员成员；成员含 id，响应可能含 name/managerType'),
    field('organization[].id', 'string | number', '组织成员 ID'),
    field('post[].id', 'string | number', '岗位成员 ID'),
    field('duty[].id', 'string | number', '职务成员 ID'),
    field('user[].id', 'string | number', '人员成员 ID'),
    field('organization[].managerType', 'number | null', 'Portal 共享展示用管理类型原值；保存时不提交', { nullable: true, nullMeaning: '响应未返回' }),
    field('post[].managerType', 'number | null', 'Portal 共享展示用管理类型原值；保存时不提交', { nullable: true, nullMeaning: '响应未返回' }),
    field('duty[].managerType', 'number | null', 'Portal 共享展示用管理类型原值；保存时不提交', { nullable: true, nullMeaning: '响应未返回' }),
    field('user[].managerType', 'number | null', 'Portal 共享展示用管理类型原值；保存时不提交', { nullable: true, nullMeaning: '响应未返回' }),
  ],
  empty: '没有共享成员时四个数组为空；权限、网络或响应形状错误仍抛出。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ 8b9a5554d4: app/portal/menus/hr.js、views/dashboard/hr/certificate/honors.vue、honors/list.vue、honors/[mode]/[id].vue、components/portal/hxr/modal-share-user/index.vue', kind: 'reference', note: '逐页核对荣誉管理菜单路径/权限、列表初始筛选与可达动作、表单条件校验、日期/附件/提醒人员转换和共享 type=10。' },
  { source: 'CodeReview_Mall_Platform_Java @ d83e4086fd5: HonorController、HonorServiceImpl、HonorSaveReqVO、HonorRespVO、HonorPageReqVO、HonorDO、ShareTypeEnum', kind: 'reference', note: '核对荣誉 CRUD 端点、Long ID、字段类型、租户/当前会话数据范围、组织名称补充、共享类型和 Boolean 回执。' },
  { source: 'src/capabilities/honor.ts 与 test/honor.test.ts', kind: 'implementation', note: '锁定 Portal 请求形状、条件必填、附件 PDF 数量/成对关系、共享成员映射和坏响应反证；不替代真实环境写入回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「风险防控 → 荣誉管理」列表、荣誉表单或共享设置。',
  boundaries: [
    '页面路径是/dashboard/certificate/honors/list，权限是/dashboard/certificate/honors；请求使用 platform HTTP 实例和 module-type=15（风险防控），调用方不要另拼页面上下文。',
    '列表、详情、写入和共享都受当前会话、租户、页面权限及后端数据范围约束；SDK 不扩大可见范围，也不把空列表当作无权限或授权成功。',
    '列表只暴露 Portal 表单中的 name、organizationId、issuingAuthority、manageOrganizationId 四个筛选字段，初始值均为 null；Portal 分页还发送 order、orderField、pageNo=1、pageSize=20。',
    '表单 organizationId、isForever、name、awardedDate、issuingAuthority、reportOrganizationId、manageOrganizationId、depositAddress、pdfUrl 必填；isForever=0 时 endTime、remindTime、remindUser 也必填，isForever=1 时这三个条件字段在页面隐藏。',
    'name 最多50字符；remindTime 是 1 至 99999 的整数月数；issuingAuthority 和 depositAddress 的文本控件 maxlength 都是1000；日期格式为 YYYY-MM-DD。',
    '附件只接受 PDF，Portal 控件最多保留5项；pdfUrl 与 pdfName 按下标成对，提交时分别逗号连接，空数组发送 null。remindUser 数组提交为逗号串；空数组按 Portal 的 JavaScript truthiness 转为空串。',
    '共享 type 固定为10（荣誉）；读取响应可含 managerType，但保存组织、岗位、职务和人员时每项只提交 {id}。列表中的导出按钮在 Portal 源码中被注释，不属于可达 SDK 能力。',
    'Portal 日期选择器禁止选择今天之前的日期；SDK 不把这条 UI 选取限制扩展成对已有历史记录的强制拒绝，编辑详情中的原始日期仍按页面转换规则保留。',
  ],
  prerequisites: ['使用会话 token 和租户创建 SDK；组织、部门、提醒人员和 PDF URL 应来自已核实的 Portal 候选或上传结果，不能猜 ID。'],
  failures: ['字段必填/长度、条件规则、ID、日期、附件数量/配对、权限、租户、网络或响应形状错误会抛出；不能以 true、空回执或请求成功代替写入回查。'],
  evidence,
  gaps: ['已完成 Portal/Java 逐页静态核对与离线请求断言；尚未在真实测试环境执行荣誉新建、编辑、删除、共享及逐页回查。'],
})

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Honor contract has no definition: ${id}`)
  contracts[id] = value
}

const idInput = (meaning: string, source: string): Record<string, AiParameter> => ({ id: param(meaning, source, { type: 'string | number', required: true }) })
const formInput = param('Portal 荣誉完整表单；组织、有效期、荣誉字段、提醒人员和 PDF 附件均按页面语义填写。', '用户明确填写的表单与已核实候选结果', {
  type: 'object', required: true, constraints: ['organizationId、isForever、name、awardedDate、issuingAuthority、reportOrganizationId、manageOrganizationId、depositAddress、pdfUrl必填', 'isForever=0 时 endTime/remindTime/remindUser必填', 'name最多50字符，remindTime为1..99999整数', 'pdfUrl/pdfName最多5项且数量一致；每项为PDF URL/文件名'],
})

add('honor-list', base({
  purpose: '按荣誉名称、所属组织、颁发机构和管理部门查询当前可见的荣誉分页列表。', effect: 'read',
  inputs: {
    name: param('荣誉名称模糊筛选；省略时按 Portal 初始表单发送 null。', '用户明确输入', { type: 'string', required: false, nullable: true, omitted: '发送 null' }),
    organizationId: param('所属组织 ID；必须来自已核实的角色组织候选。', '用户确认的组织候选 ID', { type: 'string | number', required: false, nullable: true, omitted: '发送 null' }),
    issuingAuthority: param('颁发机构模糊筛选；省略时发送 null。', '用户明确输入', { type: 'string', required: false, nullable: true, omitted: '发送 null' }),
    manageOrganizationId: param('管理部门 ID；必须来自已核实的角色组织候选。', '用户确认的组织候选 ID', { type: 'string | number', required: false, nullable: true, omitted: '发送 null' }),
    pageNo: param('从1开始的页码；Portal 默认1。', '调用方分页状态', { type: 'number', required: false, default: '1' }),
    pageSize: param('每页条数；Portal 默认20。', '调用方分页状态', { type: 'number', required: false, default: '20' }),
  },
  output: pageOutput,
  consume: ['用 list[].id 作为 get、prepareUpdate、remove 和共享设置的唯一定位；需要完整数据时继续翻页覆盖 total。', '列表没有导出能力；Portal 的导出按钮是注释代码，不要自行调用后端未达页面的 export-excel。'],
  steps: [{ role: 'optional', when: '需要编辑或核实写入', capabilityId: 'honor-get', mapping: { id: 'list[].id' }, instruction: '先读取同一荣誉的最新详情。' }],
  completion: '返回当前筛选的一页荣誉和 total；查询不修改数据。', idempotency: null,
}))

add('honor-get', base({
  purpose: '读取一个荣誉的最新详情，用于编辑准备和写入回查。', effect: 'read', inputs: idInput('荣誉记录 ID。', 'honor-list.list[].id'), output: detailOutput,
  consume: ['详情的 remindUser、pdfUrl、pdfName 是后端逗号字符串；prepareUpdate 会按 Portal 编辑页还原成数组。'], steps: [], completion: '得到目标荣誉的最新详情快照。', idempotency: null,
}))

add('honor-prepare-create', base({
  purpose: '按 Portal 荣誉新建表单规则校验并准备尚未写入的草稿。', effect: 'prepare', inputs: { form: formInput }, output: preparationOutput('荣誉'),
  consume: ['用户取消时只丢弃 draft；确认保存时把同一 draft 传给 honor-create。', 'organizationId、reportOrganizationId、manageOrganizationId、remindUser 的值必须是已核实 ID，pdfUrl 必须是已上传 PDF URL。'],
  steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'honor-create', mapping: { draft: 'result.draft' }, instruction: '只提交返回的 draft；收到 ID 后回查列表和详情。' }, { role: 'cancel', when: '用户取消表单', instruction: '丢弃 draft，不调用写接口。' }],
  completion: '得到已校验、尚未写入的完整荣誉草稿。', idempotency: null,
}))

add('honor-create', base({
  purpose: '保存一个已准备的荣誉新建草稿。', effect: 'write', inputs: { draft: param('honor-prepare-create 返回的完整草稿。', 'honor-prepare-create.draft', { type: 'object', required: true }) },
  output: { shape: 'string | number', fields: [field('$', 'string | number', '后端新建荣誉 ID；Long 可能序列化为字符串')], empty: '没有 ID 或请求抛错不能报告创建完成。' },
  consume: ['SDK 按 Portal customSubmit 将日期、PDF 数组和提醒人员数组转换成后端字段；返回 ID 后必须按 ID 回查。'],
  steps: [{ role: 'required', when: '响应成功或超时', capabilityId: 'honor-get', mapping: { id: 'result.$' }, instruction: '读取返回 ID 的详情，逐字段核对组织、日期、提醒和附件；超时先回查，不要换 ID 重建。' }],
  completion: 'honor-get 回查确认新记录存在且字段符合草稿后报告创建完成。', idempotency: '后端没有 requestId；超时先按返回 ID 或唯一业务字段回查，不能盲目重复创建。',
}))

add('honor-prepare-update', base({
  purpose: '基于最新荣誉详情和用户明确修改准备完整编辑草稿。', effect: 'prepare',
  inputs: { current: param('honor-get 返回的最新详情。', 'honor-get', { type: 'object', required: true }), changes: param('用户明确修改的表单字段；未修改字段保留 current。', '用户编辑意图', { type: 'object', required: false, nullable: true }) },
  output: preparationOutput('荣誉'), consume: ['prepare 会把 remindUser、pdfUrl、pdfName 逗号字符串还原为数组，再按页面规则校验；取消不调用 update。'],
  steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'honor-update', mapping: { draft: 'result.draft' }, instruction: '提交完整 draft；完成后用 honor-get 回查。' }, { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃 draft，不调用 update。' }],
  completion: '得到尚未写入的完整荣誉编辑草稿。', idempotency: null,
}))

add('honor-update', base({
  purpose: '保存已准备的荣誉编辑草稿。', effect: 'write', inputs: { draft: param('honor-prepare-update 返回的含 id 完整草稿。', 'honor-prepare-update.draft', { type: 'object', required: true }) },
  output: trueOutput, consume: ['提交是 Portal 的 PUT /admin-api/hr/honor/update；成功或超时后按 draft.id 读取详情，逐字段核对保存结果。'],
  steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'honor-get', mapping: { id: 'args.draft' }, instruction: '从 draft.id 回查同一荣誉；未确认终态前不要重复 PUT。' }],
  completion: '详情回查确认编辑后的字段已生效后报告更新完成。', idempotency: '无 requestId；PUT 是绝对值覆盖，超时先回查，避免覆盖他人后续修改。',
}))

add('honor-remove', base({
  purpose: '删除一个荣誉记录。', effect: 'write', inputs: idInput('荣誉记录 ID；必须来自当前列表或详情。', 'honor-list.list[].id'), output: trueOutput,
  consume: ['删除成功或超时后重新查询 honor-list，确认目标 ID 不再出现；不要把 true 单独当作删除证据。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'honor-list', instruction: '按原筛选刷新并确认目标 ID 已消失。' }, { role: 'cancel', when: '用户取消删除', instruction: '不调用 remove。' }],
  completion: '列表回查确认目标已消失后报告删除完成。', idempotency: '无 requestId；超时先回查列表，已删除终态不要重复发起。',
}))

add('honor-get-share', base({
  purpose: '读取一个荣誉的组织、岗位、职务和人员共享设置。', effect: 'read', inputs: { resourceId: param('荣誉记录 ID。', 'honor-list.list[].id', { type: 'string | number', required: true }) }, output: shareOutput,
  consume: ['四类数组为空表示当前没有该类共享成员；managerType 只按 Portal 原值展示，不把它当作保存参数。'], steps: [], completion: '得到荣誉共享设置快照。', idempotency: null,
}))

add('honor-save-share', base({
  purpose: '保存荣誉的组织、岗位、职务和人员共享设置。', effect: 'write',
  inputs: {
    resourceId: param('荣誉记录 ID。', 'honor-list.list[].id', { type: 'string | number', required: true }),
    organization: param('共享组织成员数组；提交时每项只取 id。', 'honor-get-share.organization 或用户确认的组织候选', { type: 'object[]', required: false }),
    post: param('共享岗位成员数组；提交时每项只取 id。', 'honor-get-share.post 或用户确认的岗位候选', { type: 'object[]', required: false }),
    duty: param('共享职务成员数组；提交时每项只取 id。', 'honor-get-share.duty 或用户确认的职务候选', { type: 'object[]', required: false }),
    user: param('共享人员成员数组；提交时每项只取 id。', 'honor-get-share.user 或用户确认的人员候选', { type: 'object[]', required: false }),
  },
  output: trueOutput,
  consume: ['Portal 请求 type 固定为10；managerType、name 等展示字段不会发送。保存后必须重新 getShare 核对四类成员。'],
  steps: [{ role: 'required', when: '保存成功或超时', capabilityId: 'honor-get-share', mapping: { resourceId: 'args.resourceId' }, instruction: '回查共享设置；未确认前不要重复覆盖保存。' }, { role: 'cancel', when: '用户取消共享设置', instruction: '不调用 saveShare。' }],
  completion: 'getShare 回查确认四类共享成员已生效后报告保存完成。', idempotency: '无 requestId；保存是覆盖式共享配置，超时先回查。',
}))

export const HONOR_AI_CONTRACTS = contracts
export const HONOR_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(HONOR_METHODS).map(([id, method]) => [`honor.${method}`, { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, '直接 SDK 方法按 inputs 接收对象参数；prepare 只产生草稿，不能被误报为已写入。'] }]),
)
