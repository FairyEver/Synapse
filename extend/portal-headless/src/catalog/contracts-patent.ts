import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { PATENT_METHODS, patentCapabilities } from '../capabilities/patent.js'

const definitions = new Map(patentCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const rowFields: AiField[] = [
  field('id', 'string | number', '专利记录 ID；Java Long 可能序列化为字符串，编辑、删除和共享必须原样保留'),
  field('certificateNumber', 'string | null', '证书号；必填且最多20字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('name', 'string | null', '发明名称；必填且最多50字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('inventor', 'string | null', '发明人；必填且最多50字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('patentNumber', 'string | null', '专利号；必填且最多20字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('applyDate', 'string | null', '专利申请日期，YYYY-MM-DD；表单可选', { nullable: true, nullMeaning: '未填写或后端未返回' }),
  field('patentee', 'string | null', '专利权人；可选且最多50字符', { nullable: true, nullMeaning: '未填写' }),
  field('address', 'string | null', '地址；可选且最多50字符', { nullable: true, nullMeaning: '未填写' }),
  field('announcementDate', 'string | null', '授权公告日，YYYY-MM-DD；表单可选', { nullable: true, nullMeaning: '未填写或后端未返回' }),
  field('announcementNumber', 'string | null', '授权公告号；可选且最多20字符', { nullable: true, nullMeaning: '未填写' }),
  field('organizationId', 'string | number | null', '所属组织 ID；表单必填', { nullable: true, nullMeaning: '未关联或后端未返回' }),
  field('organizationName', 'string | null', '所属组织名称；后端分页/详情补充', { nullable: true, nullMeaning: '未补充' }),
  field('endTime', 'string | null', '到期日期，YYYY-MM-DD；表单必填', { nullable: true, nullMeaning: '后端未返回' }),
  field('remindTime', 'number | null', '到期提醒提前月数；表单要求1至99999的整数', { nullable: true, nullMeaning: '后端未返回' }),
  field('remindUser', 'string | null', '到期提醒人员 ID 逗号串；编辑准备时还原为 ID 数组', { nullable: true, nullMeaning: '未配置或后端未返回' }),
  field('remindUserName', 'string | null', '到期提醒人员名称摘要；后端按提醒人员 ID 补充', { nullable: true, nullMeaning: '未补充' }),
  field('pdfUrl', 'string | null', 'PDF URL 逗号串；编辑准备时还原为数组，最多5项', { nullable: true, nullMeaning: '无附件' }),
  field('pdfName', 'string | null', '与 pdfUrl 按顺序对应的 PDF 文件名逗号串', { nullable: true, nullMeaning: '无附件' }),
  field('createTime', 'string | null', '创建时间原值', { nullable: true, nullMeaning: '后端未返回' }),
  field('status', 'number | null', '后端按到期日期和提醒月数计算的状态；1=已过期、2=即将到期、3=未过期', { nullable: true, nullMeaning: '后端未返回', values: { '1': '已过期', '2': '即将到期', '3': '未过期' } }),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页专利记录'), field('total', 'number', '符合筛选条件的总记录数，不是当前页长度'), ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` }))],
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
  empty: '字段、ID、日期、提醒月数、附件数量或必填规则不符合 Portal 时在发请求前抛错。',
})

const shareOutput: AiContract['output'] = {
  shape: '{ organization: object[], post: object[], duty: object[], user: object[] }',
  fields: [
    field('organization', 'object[]', '共享组织成员；成员至少含 id'), field('post', 'object[]', '共享岗位成员；成员至少含 id'), field('duty', 'object[]', '共享职务成员；成员至少含 id'), field('user', 'object[]', '共享人员成员；成员至少含 id'),
    field('organization[].id', 'string | number', '组织成员 ID'), field('post[].id', 'string | number', '岗位成员 ID'), field('duty[].id', 'string | number', '职务成员 ID'), field('user[].id', 'string | number', '人员成员 ID'),
    field('organization[].name', 'string | null', 'Portal 共享展示名称', { optional: true, nullable: true, nullMeaning: '响应未返回' }), field('post[].name', 'string | null', 'Portal 共享展示名称', { optional: true, nullable: true, nullMeaning: '响应未返回' }), field('duty[].name', 'string | null', 'Portal 共享展示名称', { optional: true, nullable: true, nullMeaning: '响应未返回' }), field('user[].name', 'string | null', 'Portal 共享展示名称', { optional: true, nullable: true, nullMeaning: '响应未返回' }),
    field('organization[].managerType', 'number | null', '共享管理类型原值；保存时不提交', { optional: true, nullable: true, nullMeaning: '响应未返回' }), field('post[].managerType', 'number | null', '共享管理类型原值；保存时不提交', { optional: true, nullable: true, nullMeaning: '响应未返回' }), field('duty[].managerType', 'number | null', '共享管理类型原值；保存时不提交', { optional: true, nullable: true, nullMeaning: '响应未返回' }), field('user[].managerType', 'number | null', '共享管理类型原值；保存时不提交', { optional: true, nullable: true, nullMeaning: '响应未返回' }),
  ],
  empty: '没有共享成员时四个数组为空；权限、网络或响应形状错误仍抛出。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ 8b9a5554d4: app/portal/menus/hr.js、views/dashboard/hr/certificate/patent/list.vue、patent/[mode]/[id].vue、views/dashboard/hr/certificate/defines.js、components/portal/hxr/modal-share-user/index.vue', kind: 'reference', note: '逐页核对菜单路径/权限、三个可见筛选、注释掉的 status 筛选、CRUD、共享 type=6、表单日期/提醒/附件规则和到期状态展示。' },
  { source: 'CodeReview_Mall_Platform_Java @ d83e4086fd5: HrPatentController、HrPatentServiceImpl、HrPatentSaveReqVO、HrPatentRespVO、HrPatentPageReqVO、HrPatentDO、ShareTypeEnum', kind: 'reference', note: '核对专利 CRUD、Long/LocalDate/Integer/逗号字段、到期状态与提醒人员补充、租户数据对象、Excel/App 专用端点和共享类型。' },
  { source: 'src/capabilities/patent.ts 与 test/patent.test.ts', kind: 'implementation', note: '锁定 Portal 请求形状、隐藏筛选固定值、表单规则、日期/提醒/附件转换、共享成员映射和坏响应反证；不替代真实环境写入回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「风险防控 → 专利管理」列表、专利表单或共享设置。',
  boundaries: [
    '页面路径是/dashboard/certificate/patent/list，权限是/dashboard/certificate/patent；请求使用 platform HTTP 实例和 module-type=15（风险防控）。',
    '列表只暴露 Portal 当前可见的 name、patentNumber、inventor 三个筛选字段，初始值为空字符串；源码中的 status 筛选控件已注释，SDK 不把它作为用户参数，但按页面实际请求固定发送 status=""。分页默认 pageNo=1、pageSize=20，并发送空 order/orderField。',
    'certificateNumber、name、inventor、patentNumber、organizationId、endTime、remindTime、remindUser、pdfUrl 必填；applyDate、patentee、address、announcementDate、announcementNumber 可选。文本上限为20/50/50/20/50/50/20，提醒月数是1至99999的整数。',
    '日期字段按 YYYY-MM-DD 提交；remindUser、pdfUrl、pdfName 在提交时分别逗号连接。Portal 只接受 PDF，上传控件最多保留5项；pdfUrl 必须至少一项，pdfUrl 与 pdfName 按下标成对。',
    'status 是后端按到期日期和提醒月数计算的展示字段：1=已过期、2=即将到期、3=未过期，不是保存参数。共享 type 固定为6（专利）；读取的 name/managerType 只展示，保存成员时每项只提交 {id}。列表中没有可达导出按钮，后端 export-excel 不注册为页面能力。',
    '列表、详情、写入和共享受当前会话、租户、页面权限及后端数据范围约束；SDK 不把 HTTP 成功、true 或空列表单独当作业务完成证据。APP 专用知识产权端点不接入本页面能力。',
  ],
  prerequisites: ['使用当前用户会话、租户和页面权限创建 SDK；组织、提醒人员 ID 和已上传 PDF URL 必须来自已核实的 Portal 候选或上传结果。'],
  failures: ['表单规则、ID、日期、提醒月数、附件数量/配对、权限、租户、网络或响应形状错误原样抛出；不把空页、空详情或 true 当作最终业务证据。'],
  evidence,
  gaps: ['已完成 Portal/Java 逐页静态核对与离线请求断言；尚未在真实测试环境执行专利 prepare→submit→cancel、删除、共享及写入回查。'],
})

const definitionsById = new Map(patentCapabilities.map(definition => [definition.id, definition]))
const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitionsById.has(id)) throw new Error(`Patent contract has no definition: ${id}`)
  contracts[id] = value
}

const listInputs: Record<string, AiParameter> = {
  name: param('发明名称筛选；省略时发送空字符串。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  patentNumber: param('专利号筛选；省略时发送空字符串。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  inventor: param('发明人筛选；省略时发送空字符串。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  pageNo: param('从1开始的页码；Portal 默认1。', '调用方分页状态', { type: 'number', required: false, default: '1' }),
  pageSize: param('每页条数；Portal 默认20。', '调用方分页状态', { type: 'number', required: false, default: '20' }),
}
const idInput = (meaning: string, source: string): Record<string, AiParameter> => ({ id: param(meaning, source, { type: 'string | number', required: true }) })
const formInput = param('Portal 专利表单对象；包含专利基本信息、组织、到期提醒人员和已上传 PDF 数组。', '用户明确填写的表单和已核实候选', { type: 'object', required: true, constraints: ['证书号/名称/发明人/专利号最多20/50/50/20字符', 'endTime为YYYY-MM-DD且必填', 'remindTime为1至99999整数', 'pdfUrl至少1项、pdfUrl/pdfName最多5项且数量一致'] })
const draftInput = (meaning: string): AiParameter => param(meaning, 'patent-prepare-create 或 patent-prepare-update.draft', { type: 'object', required: true })

add('patent-list', base({ purpose: '读取当前用户在专利管理页面可见的专利分页列表。', effect: 'read', inputs: listInputs, output: pageOutput, consume: ['用 list[].id 作为 get、prepareUpdate、remove 和共享的唯一定位；status 仅用于展示到期状态。'], steps: [], completion: '返回当前筛选的一页专利记录和 total；查询不修改数据。', idempotency: null }))
add('patent-get', base({ purpose: '读取一条专利的最新详情，用于编辑准备和写入回查。', effect: 'read', inputs: idInput('专利记录 ID。', 'patent-list.list[].id'), output: detailOutput, consume: ['详情中的 remindUser、pdfUrl、pdfName 是后端逗号字符串；prepareUpdate 会按 Portal 编辑页还原为数组。'], steps: [], completion: '得到目标专利的最新详情快照。', idempotency: null }))
add('patent-prepare-create', base({ purpose: '按 Portal 专利新建表单规则校验并准备尚未写入的草稿。', effect: 'prepare', inputs: { form: formInput }, output: preparationOutput('专利'), consume: ['用户取消时只丢弃 draft；确认保存时把同一 draft 传给 patent-create。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'patent-create', mapping: { draft: 'result.draft' }, instruction: '只提交返回的 draft；收到 ID 后回查详情和列表。' }, { role: 'cancel', when: '用户取消表单', instruction: '丢弃 draft，不调用写接口。' }], completion: '得到已校验、尚未写入的完整新建草稿。', idempotency: null }))
add('patent-create', base({ purpose: '保存一个已准备的专利新建草稿。', effect: 'write', inputs: { draft: draftInput('patent-prepare-create 返回的完整新建草稿。') }, output: { shape: 'string | number', fields: [field('$', 'string | number', '后端新建专利 ID；Long 可能序列化为字符串')], empty: '没有 ID 或请求抛错不能报告创建完成。' }, consume: ['SDK 按 Portal customSubmit 把日期、提醒人员和 PDF 数组转换成后端字段；返回 ID 后必须按 ID 回查。'], steps: [{ role: 'required', when: '响应成功或超时', capabilityId: 'patent-get', mapping: { id: 'result.$' }, instruction: '读取返回 ID 的详情，逐字段核对表单、提醒和附件；超时先回查，不要换 ID 重建。' }], completion: 'patent-get 回查确认新记录存在且字段符合草稿后报告创建完成。', idempotency: '后端没有 requestId；超时先按返回 ID 或业务字段回查，不能盲目重复创建。' }))
add('patent-prepare-update', base({ purpose: '基于最新专利详情和用户明确修改准备完整编辑草稿。', effect: 'prepare', inputs: { current: param('patent-get 返回的最新详情。', 'patent-get', { type: 'object', required: true }), changes: param('用户明确修改的表单字段；未修改字段保留 current。', '用户编辑意图', { type: 'object', required: false, nullable: true }) }, output: preparationOutput('专利'), consume: ['prepare 会把提醒人员和附件逗号字符串还原为数组，再按页面规则校验；取消不调用 update。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'patent-update', mapping: { draft: 'result.draft' }, instruction: '提交完整 draft；完成后用 patent-get 回查。' }, { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃 draft，不调用 update。' }], completion: '得到尚未写入的完整编辑草稿。', idempotency: null }))
add('patent-update', base({ purpose: '保存已准备的专利编辑草稿。', effect: 'write', inputs: { draft: draftInput('patent-prepare-update 返回的含 id 完整草稿。') }, output: trueOutput, consume: ['提交是 Portal 的 PUT /admin-api/hr/patent/update；成功或超时后按 draft.id 读取详情，逐字段核对保存结果。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'patent-get', mapping: { id: 'args.draft' }, instruction: '从 draft.id 回查同一专利；未确认终态前不要重复 PUT。' }], completion: '详情回查确认编辑后的字段已生效后报告更新完成。', idempotency: '无 requestId；PUT 是绝对值覆盖，超时先回查，避免覆盖他人后续修改。' }))
add('patent-remove', base({ purpose: '删除一条专利记录。', effect: 'write', inputs: idInput('专利记录 ID；必须来自当前列表或详情。', 'patent-list.list[].id'), output: trueOutput, consume: ['删除成功或超时后重新查询 patent-list，确认目标 ID 不再出现；不要把 true 单独当作删除证据。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'patent-list', instruction: '按原筛选刷新并确认目标 ID 已消失。' }, { role: 'cancel', when: '用户取消删除', instruction: '不调用 remove。' }], completion: '列表回查确认目标已消失后报告删除完成。', idempotency: '无 requestId；超时先回查列表，已删除终态不要重复发起。' }))
add('patent-get-share', base({ purpose: '读取一条专利的组织、岗位、职务和人员共享设置。', effect: 'read', inputs: { resourceId: param('专利记录 ID。', 'patent-list.list[].id', { type: 'string | number', required: true }) }, output: shareOutput, consume: ['四类数组为空表示当前没有该类共享成员；managerType 只按 Portal 原值展示，不把它当作保存参数。'], steps: [], completion: '得到专利共享设置快照。', idempotency: null }))
add('patent-save-share', base({ purpose: '保存一条专利的组织、岗位、职务和人员共享设置。', effect: 'write', inputs: { resourceId: param('专利记录 ID。', 'patent-list.list[].id', { type: 'string | number', required: true }), organization: param('共享组织成员数组；提交时每项只取 id。', 'patent-get-share.organization 或用户确认选择', { type: 'object[]', required: false }), post: param('共享岗位成员数组；提交时每项只取 id。', 'patent-get-share.post 或用户确认选择', { type: 'object[]', required: false }), duty: param('共享职务成员数组；提交时每项只取 id。', 'patent-get-share.duty 或用户确认选择', { type: 'object[]', required: false }), user: param('共享人员成员数组；提交时每项只取 id。', 'patent-get-share.user 或用户确认选择', { type: 'object[]', required: false }) }, output: trueOutput, consume: ['Portal 请求 type 固定为6；managerType、name 等展示字段不会发送。保存后必须重新 getShare 核对四类成员。'], steps: [{ role: 'required', when: '保存成功或超时', capabilityId: 'patent-get-share', mapping: { resourceId: 'args.resourceId' }, instruction: '回查共享设置；未确认前不要重复覆盖保存。' }, { role: 'cancel', when: '用户取消共享设置', instruction: '不调用 saveShare。' }], completion: 'getShare 回查确认四类共享成员已生效后报告保存完成。', idempotency: '无 requestId；保存是覆盖式共享配置，超时先回查。' }))

export const PATENT_AI_CONTRACTS = contracts
export const PATENT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(PATENT_METHODS).map(([id, method]) => [`patent.${method}`, { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, '直接 SDK 方法按 inputs 接收对象参数；prepare 只产生草稿，不能被误报为已写入。'] }]))
