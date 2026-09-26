import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { PIECE_METHODS, pieceCapabilities } from '../capabilities/piece.js'

const definitions = new Map(pieceCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const rowFields: AiField[] = [
  field('id', 'string | number', '作品记录 ID；Java Long 可能序列化为字符串，编辑、删除和共享必须原样保留'),
  field('softwareNumber', 'string | null', '证书号；表单必填且最多20字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('name', 'string | null', '作品名称；表单必填且最多50字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('author', 'string | null', '作者；表单必填且最多50字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('type', 'number | null', '作品类别字典值 works_type；表单必填', { nullable: true, nullMeaning: '未选择' }),
  field('typeStr', 'string | null', '后端按 works_type 补充的作品类别名称', { nullable: true, nullMeaning: '后端未补充' }),
  field('copyrightOwner', 'string | null', '著作权人；表单必填且最多50字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('completeDate', 'string | null', '创作完成日期，YYYY-MM-DD；表单必填', { nullable: true, nullMeaning: '后端未返回' }),
  field('isPublish', 'number | null', '是否发表；1=发表、2=未发表', { nullable: true, nullMeaning: '后端未返回', values: { '1': '发表', '2': '未发表' } }),
  field('publishDate', 'string | null', '首次发表日期，YYYY-MM-DD；Portal 校验规则要求填写', { nullable: true, nullMeaning: '后端未返回' }),
  field('signDate', 'string | null', '登记日期，YYYY-MM-DD；表单必填', { nullable: true, nullMeaning: '后端未返回' }),
  field('organizationId', 'string | number | null', '所属组织 ID；表单必填', { nullable: true, nullMeaning: '未关联或后端未返回' }),
  field('organizationName', 'string | null', '所属组织名称；后端分页/详情补充', { nullable: true, nullMeaning: '未补充' }),
  field('endTime', 'string | null', '到期日期，YYYY-MM-DD；表单必填', { nullable: true, nullMeaning: '后端未返回' }),
  field('remindTime', 'number | null', '到期提醒提前月数；Portal 要求1至99999整数', { nullable: true, nullMeaning: '未配置' }),
  field('remindUser', 'string | null', '到期提醒人员 ID 逗号串；编辑准备时还原为数组', { nullable: true, nullMeaning: '未配置或后端未返回' }),
  field('remindUserName', 'string | null', '到期提醒人员名称摘要；后端补充', { nullable: true, nullMeaning: '未补充' }),
  field('pdfUrl', 'string | null', 'PDF 附件 URL 逗号串；编辑准备时还原为数组，最多5项', { nullable: true, nullMeaning: '无附件' }),
  field('pdfName', 'string | null', '与 pdfUrl 按顺序对应的 PDF 文件名逗号串', { nullable: true, nullMeaning: '无附件' }),
  field('createTime', 'string | null', '创建时间原值', { nullable: true, nullMeaning: '后端未返回' }),
  field('status', 'number | null', '后端按到期日期和提醒月数计算的状态；1=已过期、2=即将过期、3=未过期', { nullable: true, nullMeaning: '后端未返回', values: { '1': '已过期', '2': '即将过期', '3': '未过期' } }),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页作品记录'), field('total', 'number', '符合筛选条件的总记录数，不是当前页长度'), ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[] 表示当前页没有记录；total=0 表示当前筛选没有记录。权限、会话、网络或响应形状错误会抛出，不降级为空页。',
}
const detailOutput: AiContract['output'] = { shape: 'object', fields: rowFields, empty: '不存在、无权限或响应字段形状不符合 Portal 详情会抛错；SDK 不把缺失详情降级为空对象。' }
const trueOutput: AiContract['output'] = { shape: 'true', fields: [field('$', 'true', '后端 CommonResult<Boolean> 解包后的成功值 true')], empty: '没有 true 或请求抛错不能报告保存、删除或共享成功；写操作必须按 steps 回查。' }
const preparationOutput = (label: string): AiContract['output'] => ({ shape: '{ draft: object, previous?: object }', fields: [field('draft', 'object', `${label}已按 Portal 表单规则校验、尚未写入的完整草稿`), field('previous', 'object', '编辑前的表单快照；取消时只丢弃 draft，不调用写接口', { optional: true })], empty: '字段、ID、日期、提醒月数、附件数量或必填规则不符合 Portal 时在发请求前抛错。' })
const shareOutput: AiContract['output'] = { shape: '{ organization: object[], post: object[], duty: object[], user: object[] }', fields: [field('organization', 'object[]', '共享组织成员；成员含 id，响应可能含 name/managerType'), field('post', 'object[]', '共享岗位成员；成员含 id，响应可能含 name/managerType'), field('duty', 'object[]', '共享职务成员；成员含 id，响应可能含 name/managerType'), field('user', 'object[]', '共享人员成员；成员含 id，响应可能含 name/managerType'), field('organization[].id', 'string | number', '组织成员 ID'), field('post[].id', 'string | number', '岗位成员 ID'), field('duty[].id', 'string | number', '职务成员 ID'), field('user[].id', 'string | number', '人员成员 ID')], empty: '没有共享成员时四个数组为空；权限、网络或响应形状错误仍抛出。' }

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ 8b9a5554d4: app/portal/menus/hr.js、views/dashboard/hr/certificate/works/list.vue、works/[mode]/[id].vue、components/portal/hxr/modal-share-user/index.vue', kind: 'reference', note: '逐页核对作品管理菜单路径/权限、三项可见筛选、隐藏 status、CRUD、发表状态、日期/提醒/PDF 表单规则和共享 type=7；页面没有可达导出按钮。' },
  { source: 'CodeReview_Mall_Platform_Java @ d83e4086fd5: HrPieceController、HrPiecePageReqVO、HrPieceSaveReqVO、HrPieceRespVO、HrPieceServiceImpl、HrPieceDO、ShareTypeEnum', kind: 'reference', note: '核对作品分页、详情、创建返回 Long、更新/删除 Boolean、状态/提醒人/组织名称补充、租户数据对象和共享类型。' },
  { source: 'src/capabilities/piece.ts 与 test/piece.test.ts', kind: 'implementation', note: '锁定 Portal 请求形状、日期/发表状态/附件配对、共享成员映射和坏响应反证；不替代真实环境写入回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「风险防控 → 作品管理」列表、作品表单或共享设置。',
  boundaries: [
    '页面路径是/dashboard/certificate/works/list，权限是/dashboard/certificate/works；请求使用 platform HTTP 实例和 module-type=15（风险防控），调用方不要另拼页面上下文。',
    '列表只暴露 Portal 当前可见的 name、softwareNumber、author 三个筛选字段，初始值均为空字符串；status 虽在表单状态中存在但筛选控件已注释，SDK 固定发送空字符串；分页默认 pageNo=1、pageSize=20，并发送空 order/orderField。',
    'softwareNumber/name/author/copyrightOwner/completeDate/isPublish/publishDate/signDate/organizationId/endTime/remindTime/remindUser/pdfUrl 必填；name/author/copyrightOwner最多50字符，softwareNumber最多20字符，isPublish只能是1发表或2未发表，remindTime为1至99999整数。',
    'Portal 的 publishDate 校验规则即使未发表时控件隐藏也仍登记为必填；日期按 YYYY-MM-DD 传输；remindUser 提交为人员 ID 逗号串。',
    '附件只接受 application/pdf，Portal 控件最多保留5项；pdfUrl 与 pdfName 按下标成对，提交时分别逗号连接，空数组按 Portal 规则转 null。作品类别 type 是 works_type 字典值，必须使用已核实候选。',
    '共享 type 固定为7（作品）；读取的 name/managerType 只展示，保存组织、岗位、职务和人员时每项只提交 {id}。列表源码中的导出相关死代码没有页面入口，不注册 export。',
    '列表、详情、写入和共享受当前会话、租户、页面权限及后端数据范围约束；SDK 不把 HTTP 成功、true 或空页单独当作业务完成证据。',
  ],
  prerequisites: ['使用当前用户会话、租户和页面权限创建 SDK；组织、提醒人员、作品类别候选和已上传 PDF URL 必须来自已核实的 Portal 候选或上传结果。'],
  failures: ['表单规则、ID、日期、发表状态、提醒月数、附件数量/配对、权限、租户、网络或响应形状错误原样抛出；不把空页、空详情或 true 当作最终业务证据。'],
  evidence,
  gaps: ['已完成 Portal/Java 逐页静态核对与离线请求断言；尚未在真实测试环境执行作品 prepare→submit→cancel、删除、共享及写入回查。'],
})

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Piece contract has no definition: ${id}`)
  contracts[id] = value
}

const listInputs: Record<string, AiParameter> = {
  name: param('作品名称筛选；省略时发送空字符串。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  softwareNumber: param('证书号筛选；省略时发送空字符串。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  author: param('作者筛选；省略时发送空字符串。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  pageNo: param('从1开始的页码；Portal 默认1。', '调用方分页状态', { type: 'number', required: false, default: '1' }),
  pageSize: param('每页条数；Portal 默认20。', '调用方分页状态', { type: 'number', required: false, default: '20' }),
}
const idInput = (meaning: string, source: string): Record<string, AiParameter> => ({ id: param(meaning, source, { type: 'string | number', required: true }) })
const formInput = param('Portal 作品完整表单；作品字段、发表状态、日期、所属组织、提醒人员和已上传 PDF 数组均按页面语义填写。', '用户明确填写的表单与已核实候选结果', { type: 'object', required: true, constraints: ['softwareNumber/name/author/copyrightOwner/completeDate/isPublish/publishDate/signDate/organizationId/endTime/remindTime/remindUser/pdfUrl必填', 'softwareNumber最多20字符，name/author/copyrightOwner最多50字符，remindTime为1..99999整数', 'isPublish只能是1或2，pdfUrl/pdfName最多5项且数量一致'] })
const draftInput = (meaning: string): AiParameter => param(meaning, 'piece-prepare-create 或 piece-prepare-update.draft', { type: 'object', required: true })

add('piece-list', base({ purpose: '按作品名称、证书号和作者查询当前可见的作品分页列表。', effect: 'read', inputs: listInputs, output: pageOutput, consume: ['用 list[].id 作为 get、prepareUpdate、remove 和共享设置的唯一定位；status 只展示到期状态，typeStr 是后端字典名称。'], steps: [{ role: 'optional', when: '需要编辑或核实写入', capabilityId: 'piece-get', mapping: { id: 'list[].id' }, instruction: '先读取同一作品的最新详情。' }], completion: '返回当前筛选的一页作品和 total；查询不修改数据。', idempotency: null }))
add('piece-get', base({ purpose: '读取一条作品的最新详情，用于编辑准备和写入回查。', effect: 'read', inputs: idInput('作品记录 ID。', 'piece-list.list[].id'), output: detailOutput, consume: ['详情中的 remindUser、pdfUrl、pdfName 是后端逗号字符串；prepareUpdate 会按 Portal 编辑页还原为数组。'], steps: [], completion: '得到目标作品的最新详情快照。', idempotency: null }))
add('piece-prepare-create', base({ purpose: '按 Portal 作品新建表单规则校验并准备尚未写入的草稿。', effect: 'prepare', inputs: { form: formInput }, output: preparationOutput('作品'), consume: ['用户取消时只丢弃 draft；确认保存时把同一 draft 传给 piece-create。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'piece-create', mapping: { draft: 'result.draft' }, instruction: '只提交返回的 draft；收到 ID 后回查详情和列表。' }, { role: 'cancel', when: '用户取消表单', instruction: '丢弃 draft，不调用写接口。' }], completion: '得到已校验、尚未写入的完整作品草稿。', idempotency: null }))
add('piece-create', base({ purpose: '保存一个已准备的作品新建草稿。', effect: 'write', inputs: { draft: draftInput('piece-prepare-create 返回的完整新建草稿。') }, output: { shape: 'string | number', fields: [field('$', 'string | number', '后端新建作品 ID；Long 可能序列化为字符串')], empty: '没有 ID 或请求抛错不能报告创建完成。' }, consume: ['SDK 按 Portal customSubmit 将日期、提醒人员和 PDF 数组转换成后端字段；返回 ID 后必须按 ID 回查。'], steps: [{ role: 'required', when: '响应成功或超时', capabilityId: 'piece-get', mapping: { id: 'result.$' }, instruction: '读取返回 ID 的详情，逐字段核对作品字段、发表状态、日期、提醒人员和附件；超时先回查，不要换 ID 重建。' }], completion: 'piece-get 回查确认新记录存在且字段符合草稿后报告创建完成。', idempotency: '后端没有 requestId；超时先按返回 ID 或唯一业务字段回查，不能盲目重复创建。' }))
add('piece-prepare-update', base({ purpose: '基于最新作品详情和用户明确修改准备完整编辑草稿。', effect: 'prepare', inputs: { current: param('piece-get 返回的最新详情。', 'piece-get', { type: 'object', required: true }), changes: param('用户明确修改的表单字段；未修改字段保留 current。', '用户编辑意图', { type: 'object', required: false, nullable: true }) }, output: preparationOutput('作品'), consume: ['prepare 会把提醒人员和附件逗号字符串还原为数组，再按页面规则校验；取消不调用 update。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'piece-update', mapping: { draft: 'result.draft' }, instruction: '提交完整 draft；完成后用 piece-get 回查。' }, { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃 draft，不调用 update。' }], completion: '得到尚未写入的完整作品编辑草稿。', idempotency: null }))
add('piece-update', base({ purpose: '保存已准备的作品编辑草稿。', effect: 'write', inputs: { draft: draftInput('piece-prepare-update 返回的含 id 完整草稿。') }, output: trueOutput, consume: ['提交是 Portal 的 PUT /admin-api/hr/piece/update；成功或超时后按 draft.id 读取详情，逐字段核对保存结果。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'piece-get', mapping: { id: 'args.draft' }, instruction: '从 draft.id 回查同一作品；未确认终态前不要重复 PUT。' }], completion: '详情回查确认编辑后的字段已生效后报告更新完成。', idempotency: '无 requestId；PUT 是绝对值覆盖，超时先回查，避免覆盖他人后续修改。' }))
add('piece-remove', base({ purpose: '删除一条作品记录。', effect: 'write', inputs: idInput('作品记录 ID；必须来自当前列表或详情。', 'piece-list.list[].id'), output: trueOutput, consume: ['删除是逻辑删除；成功或超时后重新查询 piece-list，确认目标 ID 不再出现。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'piece-list', instruction: '按原筛选刷新并确认目标 ID 已消失；后端权限或业务错误原样报告。' }, { role: 'cancel', when: '用户取消删除', instruction: '不调用 remove。' }], completion: '列表回查确认目标已消失后报告删除完成。', idempotency: '无 requestId；超时先回查列表，已删除终态不要重复发起。' }))
add('piece-get-share', base({ purpose: '读取一条作品的组织、岗位、职务和人员共享设置。', effect: 'read', inputs: { resourceId: param('作品记录 ID。', 'piece-list.list[].id', { type: 'string | number', required: true }) }, output: shareOutput, consume: ['四类数组为空表示当前没有该类共享成员；managerType 只按 Portal 原值展示，不把它当作保存参数。'], steps: [], completion: '得到作品共享设置快照。', idempotency: null }))
add('piece-save-share', base({ purpose: '保存一条作品的组织、岗位、职务和人员共享设置。', effect: 'write', inputs: { resourceId: param('作品记录 ID。', 'piece-list.list[].id', { type: 'string | number', required: true }), organization: param('共享组织成员数组；提交时每项只取 id。', 'piece-get-share.organization 或用户确认选择', { type: 'object[]', required: false }), post: param('共享岗位成员数组；提交时每项只取 id。', 'piece-get-share.post 或用户确认选择', { type: 'object[]', required: false }), duty: param('共享职务成员数组；提交时每项只取 id。', 'piece-get-share.duty 或用户确认选择', { type: 'object[]', required: false }), user: param('共享人员成员数组；提交时每项只取 id。', 'piece-get-share.user 或用户确认选择', { type: 'object[]', required: false }) }, output: trueOutput, consume: ['Portal 请求 type 固定为7；managerType、name 等展示字段不会发送。保存后必须重新 getShare 核对四类成员。'], steps: [{ role: 'required', when: '保存成功或超时', capabilityId: 'piece-get-share', mapping: { resourceId: 'args.resourceId' }, instruction: '回查共享设置；未确认前不要重复覆盖保存。' }, { role: 'cancel', when: '用户取消共享设置', instruction: '不调用 saveShare。' }], completion: 'getShare 回查确认四类共享成员已生效后报告保存完成。', idempotency: '无 requestId；保存是覆盖式共享配置，超时先回查。' }))

export const PIECE_AI_CONTRACTS = contracts
export const PIECE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(PIECE_METHODS).map(([id, method]) => [`piece.${method}`, { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, '直接 SDK 方法按 inputs 接收对象参数；prepare 只产生草稿，不能被误报为已写入。'] }]))
