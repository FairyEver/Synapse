import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { LEGAL_DISPUTE_METHODS, legalDisputeCapabilities } from '../capabilities/legal-dispute.js'

const definitions = new Map(legalDisputeCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const rowFields: AiField[] = [
  field('id', 'string | number', '法律纠纷记录 ID；Java Long 可能序列化为字符串，编辑、删除和共享必须原样保留'),
  field('organizationId', 'string | number | null', '所属组织 ID', { nullable: true, nullMeaning: '未关联或后端未返回' }),
  field('organizationName', 'string | null', '所属组织名称；后端分页查询补充', { nullable: true, nullMeaning: '未补充' }),
  field('year', 'number | null', '纠纷年度，表单显示为四位年份字符串', { nullable: true, nullMeaning: '后端未返回' }),
  field('disputeType', 'number | null', '纠纷类型 ID；候选字典值由 Portal 表单提供', { nullable: true, nullMeaning: '未选择或后端未返回' }),
  field('disputeTypeName', 'string | null', '纠纷类型名称；后端展示字段', { nullable: true, nullMeaning: '未补充' }),
  field('litigationType', 'number | null', '诉讼类型 ID；候选字典值由 Portal 表单提供', { nullable: true, nullMeaning: '未选择或后端未返回' }),
  field('litigationTypeName', 'string | null', '诉讼类型名称；后端展示字段', { nullable: true, nullMeaning: '未补充' }),
  field('caseReason', 'string | null', '案由；必填，最多20字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('caseNumber', 'string | null', '案号；必填，最多50字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('prosecutor', 'string | null', '原告；必填，最多100字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('defendant', 'string | null', '被告；必填，最多100字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('thirdPerson', 'string | null', '第三人；可选，最多500字符', { nullable: true, nullMeaning: '未填写' }),
  field('requestItem', 'string | null', '诉讼请求；必填，最多5000字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('amount', 'number | string | null', '涉案金额，单位为后端金额单位；支持数字或数字字符串', { nullable: true, nullMeaning: '后端未返回' }),
  field('solution', 'string | null', '解决方式；1=判决、2=调解、3=和解', { nullable: true, nullMeaning: '后端未返回', values: { '1': '判决', '2': '调解', '3': '和解' } }),
  field('result', 'string | null', '处理结果；必填，最多5000字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('causeLoss', 'number | string | null', '造成损失，单位为后端金额单位；非负，最多20字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('recoverLoss', 'number | string | null', '挽回损失，单位为后端金额单位；非负，最多20字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('pdfUrl', 'string | null', 'PDF URL 逗号串；编辑准备时还原为数组，最多10项', { nullable: true, nullMeaning: '无附件' }),
  field('pdfName', 'string | null', '与 pdfUrl 按顺序对应的 PDF 文件名逗号串', { nullable: true, nullMeaning: '无附件' }),
  field('createTime', 'string | null', '创建时间原值', { nullable: true, nullMeaning: '后端未返回' }),
  field('creator', 'string | number | null', '创建人 ID', { nullable: true, nullMeaning: '后端未返回' }),
  field('creatorName', 'string | null', '创建人名称', { nullable: true, nullMeaning: '后端未返回' }),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页法律纠纷记录'), field('total', 'number', '符合筛选条件的总记录数，不是当前页长度'), ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` }))],
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
  empty: '字段、ID、年份、附件数量或必填规则不符合 Portal 时在发请求前抛错。',
})

const shareOutput: AiContract['output'] = {
  shape: '{ organization: object[], post: object[], duty: object[], user: object[] }',
  fields: [
    field('organization', 'object[]', '共享组织成员；成员至少含 id'),
    field('post', 'object[]', '共享岗位成员；成员至少含 id'),
    field('duty', 'object[]', '共享职务成员；成员至少含 id'),
    field('user', 'object[]', '共享人员成员；成员至少含 id'),
    field('organization[].id', 'string | number', '组织成员 ID'),
    field('post[].id', 'string | number', '岗位成员 ID'),
    field('duty[].id', 'string | number', '职务成员 ID'),
    field('user[].id', 'string | number', '人员成员 ID'),
    field('organization[].name', 'string | null', 'Portal 共享展示名称', { optional: true, nullable: true, nullMeaning: '响应未返回' }),
    field('post[].name', 'string | null', 'Portal 共享展示名称', { optional: true, nullable: true, nullMeaning: '响应未返回' }),
    field('duty[].name', 'string | null', 'Portal 共享展示名称', { optional: true, nullable: true, nullMeaning: '响应未返回' }),
    field('user[].name', 'string | null', 'Portal 共享展示名称', { optional: true, nullable: true, nullMeaning: '响应未返回' }),
    field('organization[].managerType', 'number | null', '共享管理类型原值；保存时不提交', { optional: true, nullable: true, nullMeaning: '响应未返回' }),
    field('post[].managerType', 'number | null', '共享管理类型原值；保存时不提交', { optional: true, nullable: true, nullMeaning: '响应未返回' }),
    field('duty[].managerType', 'number | null', '共享管理类型原值；保存时不提交', { optional: true, nullable: true, nullMeaning: '响应未返回' }),
    field('user[].managerType', 'number | null', '共享管理类型原值；保存时不提交', { optional: true, nullable: true, nullMeaning: '响应未返回' }),
  ],
  empty: '没有共享成员时四个数组为空；权限、网络或响应形状错误仍抛出。',
}

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ 8b9a5554d4: app/portal/menus/hr.js、views/dashboard/hr/certificate/legalDisputes/list.vue、legalDisputes/[mode]/[id].vue、components/portal/hxr/modal-share-user/index.vue', kind: 'reference', note: '逐页核对菜单路径/权限、四个列表筛选、导出、CRUD、共享 type=4、14 个表单字段、条件校验和最多10个PDF附件。' },
  { source: 'CodeReview_Mall_Platform_Java @ d83e4086fd5: LegalDisputeController、LegalDisputeServiceImpl、LegalDisputeSaveReqVO、LegalDisputeRespVO、LegalDisputePageReqVO、LegalDisputeDO、ShareTypeEnum', kind: 'reference', note: '核对法律纠纷 CRUD、Long/金额/年份字段、当前租户数据范围、Boolean 回执和共享类型；APP 专用接口不计入页面能力。' },
  { source: 'src/capabilities/legal-dispute.ts 与 test/legal-dispute.test.ts', kind: 'implementation', note: '锁定 Portal 请求形状、表单规则、逗号字段转换、导出文件、共享成员映射和坏响应反证；不替代真实环境写入回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「风险防控 → 纠纷信息」列表、法律纠纷表单、Excel 导出或共享设置。',
  boundaries: [
    '页面路径是/dashboard/certificate/legalDisputes/list，权限是/dashboard/certificate/legalDisputes；请求使用 platform HTTP 实例和 module-type=15（风险防控）。',
    '列表只暴露 Portal 当前可达的 caseReason、caseNumber、prosecutor、defendant 四个筛选字段，初始值为空字符串；分页默认 pageNo=1、pageSize=20，并发送空 order/orderField。Java 页面请求中的隐藏或 APP 专用字段不属于本页面能力。',
    '表单 organizationId、year、disputeType、litigationType、caseReason、caseNumber、prosecutor、defendant、requestItem、amount、solution、result、causeLoss、recoverLoss 必填；thirdPerson 可选。文本上限依次为20、50、100、100、500、5000、5000；金额非负、最多20字符、保留两位由 Portal 控件约束。',
    'solution 固定为字符串1=判决、2=调解、3=和解；year 在表单中按四位年份字符串提交，后端响应可能是整数。pdfUrl 与 pdfName 分别逗号连接，最多10项且数量必须一致；Portal 允许无附件，空数组提交 null。',
    '共享 type 固定为4（法律纠纷）；读取响应可含 name/managerType，但保存组织、岗位、职务和人员时每项只提交 {id}。导出是页面可达动作，导出参数只有四个筛选字段，文件名是法律纠纷.xlsx。',
    '列表、详情、写入和共享受当前会话、租户、页面权限及后端数据范围约束；SDK 不把 HTTP 成功、true 或空列表单独当作业务完成证据。APP 专用 organization-list 等端点未接入页面能力。',
  ],
  prerequisites: ['使用当前用户会话、租户和页面权限创建 SDK；组织、年份、纠纷/诉讼类型、已上传 PDF URL 和共享成员 ID 必须来自已核实的 Portal 候选或用户确认。'],
  failures: ['表单规则、ID、年份、金额、附件配对、权限、租户、网络或响应形状错误原样抛出；不把空页、空详情、空文件或 false 当作成功。'],
  evidence,
  gaps: ['已完成 Portal/Java 逐页静态核对与离线请求断言；尚未在真实测试环境执行法律纠纷 prepare→submit→cancel、导出和共享回查。'],
})

const definitionsById = new Map(legalDisputeCapabilities.map(definition => [definition.id, definition]))
const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitionsById.has(id)) throw new Error(`Legal dispute contract has no definition: ${id}`)
  contracts[id] = value
}

const listInputs: Record<string, AiParameter> = {
  caseReason: param('案由筛选；省略时发送空字符串。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  caseNumber: param('案号筛选；省略时发送空字符串。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  prosecutor: param('原告筛选；省略时发送空字符串。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  defendant: param('被告筛选；省略时发送空字符串。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  pageNo: param('从1开始的页码；Portal 默认1。', '调用方分页状态', { type: 'number', required: false, default: '1' }),
  pageSize: param('每页条数；Portal 默认20。', '调用方分页状态', { type: 'number', required: false, default: '20' }),
}
const idInput = (meaning: string, source: string): Record<string, AiParameter> => ({ id: param(meaning, source, { type: 'string | number', required: true }) })
const formInput = param('Portal 法律纠纷表单对象；包含组织、年份、类型、案情、金额、处理结果和 PDF 数组。', '用户明确填写的表单和已核实候选', { type: 'object', required: true, constraints: ['14个业务字段按页面规则必填', '文本长度遵循 Portal maxlength', 'amount/causeLoss/recoverLoss非负且最多20字符', 'pdfUrl/pdfName最多10项且数量一致'] })
const draftInput = (meaning: string): AiParameter => param(meaning, 'legal-dispute-prepare-create 或 legal-dispute-prepare-update.draft', { type: 'object', required: true })

add('legal-dispute-list', base({
  purpose: '读取当前用户在纠纷信息页面可见的法律纠纷分页列表。', effect: 'read', inputs: listInputs, output: pageOutput,
  consume: ['用 list[].id 作为 get、prepareUpdate、remove 和共享的唯一定位；需要完整数据时按 total 翻页。'], steps: [], completion: '返回当前筛选的一页法律纠纷记录和 total；查询不修改数据。', idempotency: null,
}))
add('legal-dispute-get', base({
  purpose: '读取一条法律纠纷的最新详情，用于编辑准备和写入回查。', effect: 'read', inputs: idInput('法律纠纷记录 ID。', 'legal-dispute-list.list[].id'), output: detailOutput,
  consume: ['详情中的 pdfUrl/pdfName 是逗号字符串；prepareUpdate 会按 Portal 编辑页还原成数组。'], steps: [], completion: '得到目标法律纠纷的最新详情快照。', idempotency: null,
}))
add('legal-dispute-export', base({
  purpose: '导出当前四个列表筛选条件下的法律纠纷 Excel 文件。', effect: 'read', inputs: { caseReason: listInputs.caseReason!, caseNumber: listInputs.caseNumber!, prosecutor: listInputs.prosecutor!, defendant: listInputs.defendant! },
  output: { shape: 'object', fields: [field('fileName', 'string', '下载文件名，固定为法律纠纷.xlsx'), field('contentType', 'string | null', '响应 Content-Type', { nullable: true, nullMeaning: '响应未返回' }), field('base64', 'string', '导出文件内容的 base64'), field('byteLength', 'number', '文件字节数，必须大于0')], empty: '空文件、权限、网络或响应形状错误会抛出。' },
  consume: ['把 base64 交给文件落盘或下载流程；不要把导出成功当作写入成功。'], steps: [], completion: '得到非空法律纠纷 Excel 文件对象。', idempotency: null,
}))
add('legal-dispute-prepare-create', base({
  purpose: '按 Portal 法律纠纷新建表单规则校验并准备尚未写入的草稿。', effect: 'prepare', inputs: { form: formInput }, output: preparationOutput('法律纠纷'),
  consume: ['用户取消时只丢弃 draft；确认保存时把同一 draft 传给 legal-dispute-create。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'legal-dispute-create', mapping: { draft: 'result.draft' }, instruction: '只提交返回的 draft；收到 ID 后回查详情和列表。' }, { role: 'cancel', when: '用户取消表单', instruction: '丢弃 draft，不调用写接口。' }], completion: '得到已校验、尚未写入的完整新建草稿。', idempotency: null,
}))
add('legal-dispute-create', base({
  purpose: '保存一个已准备的法律纠纷新建草稿。', effect: 'write', inputs: { draft: draftInput('legal-dispute-prepare-create 返回的完整新建草稿。') }, output: { shape: 'string | number', fields: [field('$', 'string | number', '后端新建法律纠纷 ID；Long 可能序列化为字符串')], empty: '没有 ID 或请求抛错不能报告创建完成。' },
  consume: ['SDK 按 Portal customSubmit 把 year、pdfUrl 和 pdfName 转成后端字段；返回 ID 后必须按 ID 回查。'], steps: [{ role: 'required', when: '响应成功或超时', capabilityId: 'legal-dispute-get', mapping: { id: 'result.$' }, instruction: '读取返回 ID 的详情，逐字段核对表单和附件；超时先回查，不要换 ID 重建。' }], completion: 'legal-dispute-get 回查确认新记录存在且字段符合草稿后报告创建完成。', idempotency: '后端没有 requestId；超时先按返回 ID 或业务字段回查，不能盲目重复创建。',
}))
add('legal-dispute-prepare-update', base({
  purpose: '基于最新法律纠纷详情和用户明确修改准备完整编辑草稿。', effect: 'prepare', inputs: { current: param('legal-dispute-get 返回的最新详情。', 'legal-dispute-get', { type: 'object', required: true }), changes: param('用户明确修改的表单字段；未修改字段保留 current。', '用户编辑意图', { type: 'object', required: false, nullable: true }) }, output: preparationOutput('法律纠纷'),
  consume: ['prepare 会把 pdfUrl/pdfName 逗号字符串还原为数组，再按页面规则校验；取消不调用 update。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'legal-dispute-update', mapping: { draft: 'result.draft' }, instruction: '提交完整 draft；完成后用 legal-dispute-get 回查。' }, { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃 draft，不调用 update。' }], completion: '得到尚未写入的完整编辑草稿。', idempotency: null,
}))
add('legal-dispute-update', base({
  purpose: '保存已准备的法律纠纷编辑草稿。', effect: 'write', inputs: { draft: draftInput('legal-dispute-prepare-update 返回的含 id 完整草稿。') }, output: trueOutput,
  consume: ['提交是 Portal 的 PUT /admin-api/hr/legal-dispute/update；成功或超时后按 draft.id 读取详情，逐字段核对保存结果。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'legal-dispute-get', mapping: { id: 'args.draft' }, instruction: '从 draft.id 回查同一法律纠纷；未确认终态前不要重复 PUT。' }], completion: '详情回查确认编辑后的字段已生效后报告更新完成。', idempotency: '无 requestId；PUT 是绝对值覆盖，超时先回查，避免覆盖他人后续修改。',
}))
add('legal-dispute-remove', base({
  purpose: '删除一条法律纠纷记录。', effect: 'write', inputs: idInput('法律纠纷记录 ID；必须来自当前列表或详情。', 'legal-dispute-list.list[].id'), output: trueOutput,
  consume: ['删除成功或超时后重新查询 legal-dispute-list，确认目标 ID 不再出现；不要把 true 单独当作删除证据。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'legal-dispute-list', instruction: '按原筛选刷新并确认目标 ID 已消失。' }, { role: 'cancel', when: '用户取消删除', instruction: '不调用 remove。' }], completion: '列表回查确认目标已消失后报告删除完成。', idempotency: '无 requestId；超时先回查列表，已删除终态不要重复发起。',
}))
add('legal-dispute-get-share', base({
  purpose: '读取一条法律纠纷的组织、岗位、职务和人员共享设置。', effect: 'read', inputs: { resourceId: param('法律纠纷记录 ID。', 'legal-dispute-list.list[].id', { type: 'string | number', required: true }) }, output: shareOutput,
  consume: ['四类数组为空表示当前没有该类共享成员；managerType 只按 Portal 原值展示，不把它当作保存参数。'], steps: [], completion: '得到法律纠纷共享设置快照。', idempotency: null,
}))
add('legal-dispute-save-share', base({
  purpose: '保存一条法律纠纷的组织、岗位、职务和人员共享设置。', effect: 'write', inputs: {
    resourceId: param('法律纠纷记录 ID。', 'legal-dispute-list.list[].id', { type: 'string | number', required: true }),
    organization: param('共享组织成员数组；提交时每项只取 id。', 'legal-dispute-get-share.organization 或用户确认选择', { type: 'object[]', required: false }),
    post: param('共享岗位成员数组；提交时每项只取 id。', 'legal-dispute-get-share.post 或用户确认选择', { type: 'object[]', required: false }),
    duty: param('共享职务成员数组；提交时每项只取 id。', 'legal-dispute-get-share.duty 或用户确认选择', { type: 'object[]', required: false }),
    user: param('共享人员成员数组；提交时每项只取 id。', 'legal-dispute-get-share.user 或用户确认选择', { type: 'object[]', required: false }),
  }, output: trueOutput,
  consume: ['Portal 请求 type 固定为4；managerType、name 等展示字段不会发送。保存后必须重新 getShare 核对四类成员。'], steps: [{ role: 'required', when: '保存成功或超时', capabilityId: 'legal-dispute-get-share', mapping: { resourceId: 'args.resourceId' }, instruction: '回查共享设置；未确认前不要重复覆盖保存。' }, { role: 'cancel', when: '用户取消共享设置', instruction: '不调用 saveShare。' }], completion: 'getShare 回查确认四类共享成员已生效后报告保存完成。', idempotency: '无 requestId；保存是覆盖式共享配置，超时先回查。',
}))

export const LEGAL_DISPUTE_AI_CONTRACTS = contracts
export const LEGAL_DISPUTE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(LEGAL_DISPUTE_METHODS).map(([id, method]) => [`legalDispute.${method}`, { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, '直接 SDK 方法按 inputs 接收对象参数；prepare 只产生草稿，不能被误报为已写入。'] }]),
)
