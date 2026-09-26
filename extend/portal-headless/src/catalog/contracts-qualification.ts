import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { QUALIFICATION_METHODS, qualificationCapabilities } from '../capabilities/qualification.js'

const definitions = new Map(qualificationCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const rowFields: AiField[] = [
  field('id', 'string | number', '资质记录 ID；Java Long 可能序列化为字符串，编辑、删除和共享必须原样保留'),
  field('name', 'string | null', '资质名称；表单必填且最多50字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('awardedDate', 'string | null', '首次获批日期，YYYY-MM-DD；表单必填', { nullable: true, nullMeaning: '后端未返回' }),
  field('lastAwardedDate', 'string | null', '最新获批日期，YYYY-MM-DD；表单必填', { nullable: true, nullMeaning: '后端未返回' }),
  field('issuingAuthority', 'string | null', '颁发机构；表单必填且最多1000字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('reportOrganizationId', 'string | number | null', '申报部门 ID；表单必填', { nullable: true, nullMeaning: '未关联或后端未返回' }),
  field('reportOrganizationName', 'string | null', '申报部门名称；后端分页查询补充', { nullable: true, nullMeaning: '未补充' }),
  field('manageOrganizationId', 'string | number | null', '管理部门 ID；表单必填', { nullable: true, nullMeaning: '未关联或后端未返回' }),
  field('manageOrganizationName', 'string | null', '管理部门名称；后端分页查询补充', { nullable: true, nullMeaning: '未补充' }),
  field('depositAddress', 'string | null', '存放地点；表单必填且最多1000字符', { nullable: true, nullMeaning: '未填写' }),
  field('pdfUrl', 'string | null', 'PDF 附件 URL 逗号串；编辑准备时还原为数组，最多5项', { nullable: true, nullMeaning: '无附件' }),
  field('pdfName', 'string | null', '与 pdfUrl 按顺序对应的 PDF 文件名逗号串', { nullable: true, nullMeaning: '无附件' }),
  field('createTime', 'string | null', '创建时间原值', { nullable: true, nullMeaning: '后端未返回' }),
  field('isForever', '0 | 1 | null', '是否长期有效；1=是、0=否', { nullable: true, nullMeaning: '后端未返回', values: { '0': '否', '1': '是' } }),
  field('remindUser', 'string | null', '到期提醒人员 ID 逗号串；编辑准备时还原为 ID 数组', { nullable: true, nullMeaning: '未配置' }),
  field('organizationId', 'string | number | null', '所属组织 ID；表单必填', { nullable: true, nullMeaning: '未关联或后端未返回' }),
  field('organizationName', 'string | null', '所属组织全路径名称；后端分页查询补充', { nullable: true, nullMeaning: '未补充' }),
  field('endTime', 'string | null', '到期日期，YYYY-MM-DD；长期有效时通常为空', { nullable: true, nullMeaning: '长期有效或未返回' }),
  field('remindTime', 'number | null', '到期提醒提前月数；非长期资质要求1至99999整数', { nullable: true, nullMeaning: '长期有效或未配置' }),
  field('status', 'number | null', '后端响应原始状态；本页面没有状态筛选或编辑控件', { nullable: true, nullMeaning: '分页 CRUD 未计算时可能为空' }),
  field('remindUserName', 'string | null', '提醒人员名称摘要；后端详情/APP逻辑可能补充', { nullable: true, nullMeaning: '未补充' }),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页资质记录'), field('total', 'number', '符合筛选条件的总记录数，不是当前页长度'), ...rowFields.map(item => ({ ...item, path: 'list[].' + item.path }))],
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
  fields: [field('draft', 'object', label + '已按 Portal 表单规则校验、尚未写入的完整草稿'), field('previous', 'object', '编辑前的表单快照；取消时只丢弃 draft，不调用写接口', { optional: true })],
  empty: '字段、ID、日期、长期有效条件、提醒月数、附件数量或必填规则不符合 Portal 时在发请求前抛错。',
})

const shareOutput: AiContract['output'] = {
  shape: '{ organization: object[], post: object[], duty: object[], user: object[] }',
  fields: [
    field('organization', 'object[]', '共享组织成员；成员含 id，响应可能含 name/managerType'), field('post', 'object[]', '共享岗位成员；成员含 id，响应可能含 name/managerType'), field('duty', 'object[]', '共享职务成员；成员含 id，响应可能含 name/managerType'), field('user', 'object[]', '共享人员成员；成员含 id，响应可能含 name/managerType'),
    field('organization[].id', 'string | number', '组织成员 ID'), field('post[].id', 'string | number', '岗位成员 ID'), field('duty[].id', 'string | number', '职务成员 ID'), field('user[].id', 'string | number', '人员成员 ID'),
    field('organization[].managerType', 'number | null', 'Portal 共享展示用管理类型原值；保存时不提交', { optional: true, nullable: true, nullMeaning: '响应未返回' }), field('post[].managerType', 'number | null', 'Portal 共享展示用管理类型原值；保存时不提交', { optional: true, nullable: true, nullMeaning: '响应未返回' }), field('duty[].managerType', 'number | null', 'Portal 共享展示用管理类型原值；保存时不提交', { optional: true, nullable: true, nullMeaning: '响应未返回' }), field('user[].managerType', 'number | null', 'Portal 共享展示用管理类型原值；保存时不提交', { optional: true, nullable: true, nullMeaning: '响应未返回' }),
  ],
  empty: '没有共享成员时四个数组为空；权限、网络或响应形状错误仍抛出。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ 8b9a5554d4: app/portal/menus/hr.js、views/dashboard/hr/certificate/qualifications.vue、qualifications/list.vue、qualifications/[mode]/[id].vue、components/portal/hxr/modal-share-user/index.vue', kind: 'reference', note: '逐页核对资质管理菜单路径/权限、四个筛选、注释掉的导出动作、表单条件必填、日期/附件/提醒人员转换和共享 type=11。' },
  { source: 'CodeReview_Mall_Platform_Java @ d83e4086fd5: AptitudeController、AptitudeServiceImpl、AptitudeSaveReqVO、AptitudeRespVO、AptitudePageReqVO、AptitudeDO、AptitudeMapper、ShareTypeEnum', kind: 'reference', note: '核对资质 CRUD 端点、Long/LocalDate/Integer/逗号字段、分页组织名称补充、租户数据对象、Excel/App 专用端点和共享类型。' },
  { source: 'src/capabilities/qualification.ts 与 test/qualification.test.ts', kind: 'implementation', note: '锁定 Portal 请求形状、长期有效条件、表单字段、日期/提醒/附件转换、共享成员映射和坏响应反证；不替代真实环境写入回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「风险防控 → 资质管理」列表、资质表单或共享设置。',
  boundaries: [
    '页面路径是/dashboard/certificate/qualifications/list，权限是/dashboard/certificate/qualifications；请求使用 platform HTTP 实例和 module-type=15（风险防控），调用方不要另拼页面上下文。',
    '列表只暴露 Portal 当前可见的 name、organizationId、issuingAuthority、manageOrganizationId 四个筛选字段，初始值均为 null；分页默认 pageNo=1、pageSize=20，并发送空 order/orderField。源码中的导出按钮已注释，不注册为页面能力。',
    'organizationId、isForever、name、awardedDate、lastAwardedDate、issuingAuthority、reportOrganizationId、manageOrganizationId、depositAddress、pdfUrl 必填；isForever=0 时 endTime、remindTime、remindUser 也必填，isForever=1 时这些条件字段在页面隐藏并按 Portal 规则提交空值。',
    'name 最多50字符；issuingAuthority 和 depositAddress 最多1000字符；日期字段按 YYYY-MM-DD 提交；remindTime 是1至99999的整数月数；remindUser 是人员 ID 数组，不能用姓名或员工工号替代。',
    '附件只接受 PDF，上传控件最多保留5项；pdfUrl 与 pdfName 按下标成对，提交时分别逗号连接。pdfUrl 必须至少一项；空的条件提醒字段按 Portal 的 null/空串转换发送。',
    '共享 type 固定为11（资质）；读取的 name/managerType 只展示，保存组织、岗位、职务和人员时每项只提交 {id}。分页响应的 status 是后端原始字段，本页面没有状态筛选或编辑控件。',
    '列表、详情、写入和共享受当前会话、租户、页面权限及后端数据范围约束；SDK 不把 HTTP 成功、true 或空列表单独当作业务完成证据。APP 专用 getInfoByApp 和后端 export-excel 不接入本页面能力。',
  ],
  prerequisites: ['使用当前用户会话、租户和页面权限创建 SDK；组织、申报部门、管理部门、提醒人员 ID 和已上传 PDF URL 必须来自已核实的 Portal 候选或上传结果。'],
  failures: ['表单规则、ID、日期、长期有效条件、提醒月数、附件数量/配对、权限、租户、网络或响应形状错误原样抛出；不把空页、空详情或 true 当作最终业务证据。'],
  evidence,
  gaps: ['已完成 Portal/Java 逐页静态核对与离线请求断言；尚未在真实测试环境执行资质 prepare→submit→cancel、删除、共享及写入回查。'],
})

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error('Qualification contract has no definition: ' + id)
  contracts[id] = value
}

const idInput = (meaning: string, source: string): Record<string, AiParameter> => ({ id: param(meaning, source, { type: 'string | number', required: true }) })
const formInput = param('Portal 资质完整表单；组织、长期有效状态、资质字段、提醒人员和已上传 PDF 数组均按页面语义填写。', '用户明确填写的表单与已核实候选结果', { type: 'object', required: true, constraints: ['organizationId/isForever/name/awardedDate/lastAwardedDate/issuingAuthority/reportOrganizationId/manageOrganizationId/depositAddress/pdfUrl必填', 'isForever=0 时 endTime/remindTime/remindUser必填', 'name最多50字符，issuingAuthority/depositAddress最多1000字符，remindTime为1..99999整数', 'pdfUrl至少1项、pdfUrl/pdfName最多5项且数量一致'] })
const draftInput = (meaning: string): AiParameter => param(meaning, 'qualification-prepare-create 或 qualification-prepare-update.draft', { type: 'object', required: true })

add('qualification-list', base({
  purpose: '按资质名称、所属组织、颁发机构和管理部门查询当前可见的资质分页列表。', effect: 'read',
  inputs: {
    name: param('资质名称模糊筛选；省略时发送 null。', '用户明确输入', { type: 'string', required: false, nullable: true, omitted: '发送 null' }),
    organizationId: param('所属组织 ID；必须来自已核实的角色组织候选。', '用户确认的组织候选 ID', { type: 'string | number', required: false, nullable: true, omitted: '发送 null' }),
    issuingAuthority: param('颁发机构模糊筛选；省略时发送 null。', '用户明确输入', { type: 'string', required: false, nullable: true, omitted: '发送 null' }),
    manageOrganizationId: param('管理部门 ID；必须来自已核实的角色组织候选。', '用户确认的组织候选 ID', { type: 'string | number', required: false, nullable: true, omitted: '发送 null' }),
    pageNo: param('从1开始的页码；Portal 默认1。', '调用方分页状态', { type: 'number', required: false, default: '1' }),
    pageSize: param('每页条数；Portal 默认20。', '调用方分页状态', { type: 'number', required: false, default: '20' }),
  },
  output: pageOutput,
  consume: ['用 list[].id 作为 get、prepareUpdate、remove 和共享设置的唯一定位；需要完整数据时继续翻页覆盖 total。', 'status 是后端原始响应字段，不能据它推断页面存在额外状态筛选。'],
  steps: [{ role: 'optional', when: '需要编辑或核实写入', capabilityId: 'qualification-get', mapping: { id: 'list[].id' }, instruction: '先读取同一资质的最新详情。' }],
  completion: '返回当前筛选的一页资质和 total；查询不修改数据。', idempotency: null,
}))

add('qualification-get', base({
  purpose: '读取一条资质的最新详情，用于编辑准备和写入回查。', effect: 'read', inputs: idInput('资质记录 ID。', 'qualification-list.list[].id'), output: detailOutput,
  consume: ['详情的 remindUser、pdfUrl、pdfName 是后端逗号字符串；prepareUpdate 会按 Portal 编辑页还原为数组。', 'isForever=1 时 endTime/remindTime/remindUser 可能为空，不能按非长期资质规则补造值。'], steps: [], completion: '得到目标资质的最新详情快照。', idempotency: null,
}))

add('qualification-prepare-create', base({
  purpose: '按 Portal 资质新建表单规则校验并准备尚未写入的草稿。', effect: 'prepare', inputs: { form: formInput }, output: preparationOutput('资质'),
  consume: ['用户取消时只丢弃 draft；确认保存时把同一 draft 传给 qualification-create。', 'isForever=0 时必须准备到期日期、提醒月数和提醒人员；isForever=1 时保留 Portal 的长期有效空值语义。'],
  steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'qualification-create', mapping: { draft: 'result.draft' }, instruction: '只提交返回的 draft；收到 ID 后回查列表和详情。' }, { role: 'cancel', when: '用户取消表单', instruction: '丢弃 draft，不调用写接口。' }],
  completion: '得到已校验、尚未写入的完整资质草稿。', idempotency: null,
}))

add('qualification-create', base({
  purpose: '保存一个已准备的资质新建草稿。', effect: 'write', inputs: { draft: draftInput('qualification-prepare-create 返回的完整新建草稿。') },
  output: { shape: 'string | number', fields: [field('$', 'string | number', '后端新建资质 ID；Long 可能序列化为字符串')], empty: '没有 ID 或请求抛错不能报告创建完成。' },
  consume: ['SDK 按 Portal customSubmit 将日期、提醒人员和 PDF 数组转换成后端字段；长期有效时发送 endTime=null、remindTime=null、remindUser="" 的对应空值。返回 ID 后必须按 ID 回查。'],
  steps: [{ role: 'required', when: '响应成功或超时', capabilityId: 'qualification-get', mapping: { id: 'result.$' }, instruction: '读取返回 ID 的详情，逐字段核对组织、长期有效状态、日期、提醒和附件；超时先回查，不要换 ID 重建。' }],
  completion: 'qualification-get 回查确认新记录存在且字段符合草稿后报告创建完成。', idempotency: '后端没有 requestId；超时先按返回 ID 或唯一业务字段回查，不能盲目重复创建。',
}))

add('qualification-prepare-update', base({
  purpose: '基于最新资质详情和用户明确修改准备完整编辑草稿。', effect: 'prepare',
  inputs: { current: param('qualification-get 返回的最新详情。', 'qualification-get', { type: 'object', required: true }), changes: param('用户明确修改的表单字段；未修改字段保留 current。', '用户编辑意图', { type: 'object', required: false, nullable: true }) },
  output: preparationOutput('资质'), consume: ['prepare 会把 remindUser、pdfUrl、pdfName 逗号字符串还原为数组，再按页面规则校验；取消不调用 update。', '长期有效详情的空 endTime/remindTime/remindUser 必须保持空值，切换为非长期时再补齐三项。'],
  steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'qualification-update', mapping: { draft: 'result.draft' }, instruction: '提交完整 draft；完成后用 qualification-get 回查。' }, { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃 draft，不调用 update。' }],
  completion: '得到尚未写入的完整资质编辑草稿。', idempotency: null,
}))

add('qualification-update', base({
  purpose: '保存已准备的资质编辑草稿。', effect: 'write', inputs: { draft: draftInput('qualification-prepare-update 返回的含 id 完整草稿。') }, output: trueOutput,
  consume: ['提交是 Portal 的 PUT /admin-api/hr/aptitude/update；成功或超时后按 draft.id 读取详情，逐字段核对保存结果。'],
  steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'qualification-get', mapping: { id: 'args.draft' }, instruction: '从 draft.id 回查同一资质；未确认终态前不要重复 PUT。' }],
  completion: '详情回查确认编辑后的字段已生效后报告更新完成。', idempotency: '无 requestId；PUT 是绝对值覆盖，超时先回查，避免覆盖他人后续修改。',
}))

add('qualification-remove', base({
  purpose: '删除一条资质记录。', effect: 'write', inputs: idInput('资质记录 ID；必须来自当前列表或详情。', 'qualification-list.list[].id'), output: trueOutput,
  consume: ['删除成功或超时后重新查询 qualification-list，确认目标 ID 不再出现；不要把 true 单独当作删除证据。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'qualification-list', instruction: '按原筛选刷新并确认目标 ID 已消失。' }, { role: 'cancel', when: '用户取消删除', instruction: '不调用 remove。' }],
  completion: '列表回查确认目标已消失后报告删除完成。', idempotency: '无 requestId；超时先回查列表，已删除终态不要重复发起。',
}))

add('qualification-get-share', base({
  purpose: '读取一条资质的组织、岗位、职务和人员共享设置。', effect: 'read', inputs: { resourceId: param('资质记录 ID。', 'qualification-list.list[].id', { type: 'string | number', required: true }) }, output: shareOutput,
  consume: ['四类数组为空表示当前没有该类共享成员；managerType 只按 Portal 原值展示，不把它当作保存参数。'], steps: [], completion: '得到资质共享设置快照。', idempotency: null,
}))

add('qualification-save-share', base({
  purpose: '保存一条资质的组织、岗位、职务和人员共享设置。', effect: 'write',
  inputs: {
    resourceId: param('资质记录 ID。', 'qualification-list.list[].id', { type: 'string | number', required: true }),
    organization: param('共享组织成员数组；提交时每项只取 id。', 'qualification-get-share.organization 或用户确认的组织候选', { type: 'object[]', required: false }),
    post: param('共享岗位成员数组；提交时每项只取 id。', 'qualification-get-share.post 或用户确认的岗位候选', { type: 'object[]', required: false }),
    duty: param('共享职务成员数组；提交时每项只取 id。', 'qualification-get-share.duty 或用户确认的职务候选', { type: 'object[]', required: false }),
    user: param('共享人员成员数组；提交时每项只取 id。', 'qualification-get-share.user 或用户确认的人员候选', { type: 'object[]', required: false }),
  },
  output: trueOutput,
  consume: ['Portal 请求 type 固定为11；managerType、name 等展示字段不会发送。保存后必须重新 getShare 核对四类成员。'],
  steps: [{ role: 'required', when: '保存成功或超时', capabilityId: 'qualification-get-share', mapping: { resourceId: 'args.resourceId' }, instruction: '回查共享设置；未确认前不要重复覆盖保存。' }, { role: 'cancel', when: '用户取消共享设置', instruction: '不调用 saveShare。' }],
  completion: 'getShare 回查确认四类共享成员已生效后报告保存完成。', idempotency: '无 requestId；保存是覆盖式共享配置，超时先回查。',
}))

export const QUALIFICATION_AI_CONTRACTS = contracts
export const QUALIFICATION_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(QUALIFICATION_METHODS).map(([id, method]) => ['qualification.' + method, { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, '直接 SDK 方法按 inputs 接收对象参数；prepare 只产生草稿，不能被误报为已写入。'] }]),
)
