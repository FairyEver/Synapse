import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { TRADEMARK_METHODS, trademarkCapabilities } from '../capabilities/trademark.js'

const definitions = new Map(trademarkCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const rowFields: AiField[] = [
  field('id', 'string | number', '商标记录 ID；Java Long 可能序列化为字符串，编辑、删除、续展和共享必须原样保留'),
  field('name', 'string | null', '商标名称；表单必填且最多10字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('signNumber', 'string | null', '申请号/注册号；表单必填且最多10字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('fileUrl', 'string | null', '商标图样 URL 逗号串；编辑准备时还原为数组，最多3项', { nullable: true, nullMeaning: '未上传图样' }),
  field('category', 'number | null', 'trademark_category 字典值；表单必填', { nullable: true, nullMeaning: '后端未返回' }),
  field('type', 'number | null', '商标类型；1=驰名商标、2=著名商标', { nullable: true, nullMeaning: '未选择' }),
  field('loginTime', 'string | null', '注册日期，YYYY-MM-DD；表单必填', { nullable: true, nullMeaning: '后端未返回' }),
  field('endTime', 'string | null', '截止日期，YYYY-MM-DD；表单必填', { nullable: true, nullMeaning: '后端未返回' }),
  field('remindTime', 'number | null', '到期提醒提前月数；表单要求大于等于1的整数', { nullable: true, nullMeaning: '后端未返回' }),
  field('remindUser', 'string | null', '到期提醒人员 ID 逗号串；编辑准备时还原为数组', { nullable: true, nullMeaning: '未配置或后端未返回' }),
  field('remindUserName', 'string | null', '到期提醒人员名称摘要；后端按提醒人员 ID 补充', { nullable: true, nullMeaning: '未补充' }),
  field('product', 'string | null', '核定商品；最多500字符', { nullable: true, nullMeaning: '未填写' }),
  field('createTime', 'string | null', '创建时间原值', { nullable: true, nullMeaning: '后端未返回' }),
  field('status', 'number | null', '后端按截止日期和提醒月数计算的状态；1=已过期、2=即将过期、3=未过期', { nullable: true, nullMeaning: '后端未返回', values: { '1': '已过期', '2': '即将过期', '3': '未过期' } }),
  field('pdfUrl', 'string | null', 'PDF 附件 URL 逗号串；编辑准备时还原为数组，最多10项', { nullable: true, nullMeaning: '无附件' }),
  field('pdfName', 'string | null', '与 pdfUrl 按顺序对应的 PDF 文件名逗号串', { nullable: true, nullMeaning: '无附件' }),
  field('organizationId', 'string | number | null', '注册人所属组织 ID；表单必填', { nullable: true, nullMeaning: '未关联或后端未返回' }),
  field('organizationName', 'string | null', '注册人所属组织名称；后端分页/详情补充', { nullable: true, nullMeaning: '未补充' }),
  field('address', 'string | null', '注册地址；表单必填', { nullable: true, nullMeaning: '后端未返回' }),
  field('validStatus', 'number | null', '商标有效状态；1=有效、2=无效', { nullable: true, nullMeaning: '后端未返回', values: { '1': '有效', '2': '无效' } }),
  field('renewalRecordCount', 'number | null', '当前商标续展记录数量', { nullable: true, nullMeaning: '后端未补充' }),
  field('renewable', 'boolean | null', '当前用户是否可提交续展；false 时 Portal 禁止勾选', { nullable: true, nullMeaning: '后端未返回' }),
]

const pageOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页商标记录'), field('total', 'number', '符合筛选条件的总记录数，不是当前页长度'), ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[] 表示当前页没有记录；total=0 表示当前筛选没有记录。权限、会话、网络或响应形状错误会抛出，不降级为空页。',
}
const detailOutput: AiContract['output'] = { shape: 'object', fields: rowFields, empty: '不存在、无权限或响应字段形状不符合 Portal 详情会抛错；SDK 不把缺失详情降级为空对象。' }
const trueOutput: AiContract['output'] = { shape: 'true', fields: [field('$', 'true', '后端 CommonResult<Boolean> 解包后的成功值 true')], empty: '没有 true 或请求抛错不能报告保存、删除或共享成功；写操作必须按 steps 回查。' }
const preparationOutput = (label: string): AiContract['output'] => ({ shape: '{ draft: object, previous?: object }', fields: [field('draft', 'object', `${label}已按 Portal 表单规则校验、尚未写入的完整草稿`), field('previous', 'object', '编辑前的表单快照；取消时只丢弃 draft，不调用写接口', { optional: true })], empty: '字段、ID、日期、提醒月数、附件数量或必填规则不符合 Portal 时在发请求前抛错。' })
const fileOutput: AiContract['output'] = { shape: '{ fileName: string, contentType: string | null, base64: string, byteLength: number }', fields: [field('fileName', 'string', '导出文件名；优先取响应 Content-Disposition'), field('contentType', 'string | null', '响应 Content-Type'), field('base64', 'string', '文件内容 Base64'), field('byteLength', 'number', '原始文件字节数')], empty: '空文件或不是二进制响应会抛错。' }
const shareOutput: AiContract['output'] = { shape: '{ organization: object[], post: object[], duty: object[], user: object[] }', fields: [field('organization', 'object[]', '共享组织成员；成员含 id，响应可能含 name/managerType'), field('post', 'object[]', '共享岗位成员；成员含 id，响应可能含 name/managerType'), field('duty', 'object[]', '共享职务成员；成员含 id，响应可能含 name/managerType'), field('user', 'object[]', '共享人员成员；成员含 id，响应可能含 name/managerType'), field('organization[].id', 'string | number', '组织成员 ID'), field('post[].id', 'string | number', '岗位成员 ID'), field('duty[].id', 'string | number', '职务成员 ID'), field('user[].id', 'string | number', '人员成员 ID')], empty: '没有共享成员时四个数组为空；权限、网络或响应形状错误仍抛出。' }
const renewalOutput: AiContract['output'] = { shape: '{ trademark: object, records: object[] }', fields: [field('trademark.id', 'string | number', '续展记录所属商标 ID'), field('trademark.name', 'string | null', '商标名称', { nullable: true }), field('trademark.signNumber', 'string | null', '申请号/注册号', { nullable: true }), field('trademark.category', 'number | null', '商标类别', { nullable: true }), field('trademark.endTime', 'string | null', '当前截止日期，YYYY-MM-DD', { nullable: true }), field('records', 'object[]', '按续展时间倒序的续展记录'), field('records[].renewalTime', 'string | null', '续展提交时间', { nullable: true }), field('records[].renewalUserName', 'string | null', '续展人名称', { nullable: true }), field('records[].content', 'string | null', '续展内容', { nullable: true }), field('records[].attachments', 'object[]', '续展附件数组')], empty: 'records=[] 表示该商标没有续展记录；商标不存在、无权限或响应形状错误仍抛出。' }

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ 8b9a5554d4: app/portal/menus/hr.js、views/dashboard/hr/certificate/trademark/list.vue、trademark/[mode]/[id].vue、trademark/components/renewal-form.vue、trademark/components/renewal-records.vue、components/portal/hxr/modal-share-user/index.vue', kind: 'reference', note: '逐页核对商标菜单路径/权限、五个筛选、可达导出/CRUD/续展/记录/共享动作、表单日期/提醒/图片/PDF/文本规则和共享 type=3。' },
  { source: 'CodeReview_Mall_Platform_Java @ d83e4086fd5: TrademarkController、TrademarkServiceImpl、TrademarkSaveReqVO、TrademarkRespVO、TrademarkPageReqVO、TrademarkRenewalBatchReqVO、TrademarkRenewalRecordsRespVO、TrademarkRenewalServiceImpl、TrademarkDO、ShareTypeEnum', kind: 'reference', note: '核对商标 CRUD、导出、续展提交与记录端点、Long/LocalDate/Integer/逗号字段、租户数据和后端状态/提醒人补充。' },
  { source: 'src/capabilities/trademark.ts 与 test/trademark.test.ts', kind: 'implementation', note: '锁定 Portal 请求形状、表单反证、二进制导出、续展附件和共享成员映射；不替代真实环境写入回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「风险防控 → 商标管理」列表、商标表单、续展或共享设置。',
  boundaries: [
    '页面路径是/dashboard/certificate/trademark/list，权限是/dashboard/certificate/trademark；请求使用 platform HTTP 实例和 module-type=15（风险防控）。',
    '列表只暴露 Portal 当前可见的 signNumber、name、category、type、organizationId 五个筛选字段，初始值均为空字符串；分页默认 pageNo=1、pageSize=20，并发送空 order/orderField。',
    'validStatus、signNumber、name、category、loginTime、endTime、remindTime、remindUser、organizationId、address、pdfUrl 必填；signNumber/name最多10字符，product最多500字符，type可选且仅有1驰名商标、2著名商标。loginTime必须早于endTime，remindTime为大于等于1的整数。',
    '图样只接受图片并最多3项；附件只接受 PDF，Portal 控件最多保留10项；fileUrl、pdfUrl、pdfName 提交时分别逗号连接，pdfUrl 与 pdfName 按下标成对，pdfUrl至少一项；remindUser提交为人员 ID 逗号串。',
    'status 是后端按截止日期和提醒月数计算的展示字段：1=已过期、2=即将过期、3=未过期；renewable=false 的行不能选择续展。共享 type 固定为3（商标）；读取的 name/managerType 只展示，保存成员时每项只提交 {id}。',
    '导出按钮在 Portal 页面可达，SDK 返回文件名、Content-Type、Base64 和字节数；续展提交附件最多10项、每项不超过20MB且扩展名限 PDF/XLS/XLSX/DOC/DOCX/JPG/JPEG/PNG。',
    '列表、详情、写入、续展和共享受当前会话、租户、页面权限及后端数据范围约束；SDK 不把 HTTP 成功、true 或导出响应单独当作写入业务完成证据。',
  ],
  prerequisites: ['使用当前用户会话、租户和页面权限创建 SDK；组织、类别、提醒人员 ID、图样/PDF URL 和可续展商标必须来自已核实的 Portal 候选或上传结果。'],
  failures: ['表单规则、ID、日期、提醒月数、附件数量/配对、续展附件限制、权限、租户、网络或响应形状错误原样抛出；不把空页、空详情或 true 当作最终业务证据。'],
  evidence,
  gaps: ['已完成 Portal/Java 逐页静态核对与离线请求断言；尚未在真实测试环境执行商标 prepare→submit→cancel、删除、共享、导出、续展及写入回查。'],
})

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Trademark contract has no definition: ${id}`)
  contracts[id] = value
}

const listInputs: Record<string, AiParameter> = {
  signNumber: param('申请号/注册号筛选；省略时发送空字符串。', '用户明确输入', { type: 'string | number', required: false, default: '空字符串' }),
  name: param('商标名称筛选；省略时发送空字符串。', '用户明确输入', { type: 'string', required: false, default: '空字符串' }),
  category: param('trademark_category 字典值筛选；省略时发送空字符串。', '用户选择的字典候选', { type: 'string | number', required: false, default: '空字符串' }),
  type: param('商标类型；1=驰名商标、2=著名商标；省略时发送空字符串。', '用户选择', { type: 'number', required: false, default: '空字符串', options: [{ value: 1, label: '驰名商标' }, { value: 2, label: '著名商标' }] }),
  organizationId: param('注册人角色组织 ID；省略时发送空字符串。', '用户确认的组织候选 ID', { type: 'string | number', required: false, default: '空字符串' }),
  pageNo: param('从1开始的页码；Portal 默认1。', '调用方分页状态', { type: 'number', required: false, default: '1' }),
  pageSize: param('每页条数；Portal 默认20。', '调用方分页状态', { type: 'number', required: false, default: '20' }),
}
const idInput = (meaning: string, source: string): Record<string, AiParameter> => ({ id: param(meaning, source, { type: 'string | number', required: true }) })
const formInput = param('Portal 商标完整表单；商标基本信息、组织、日期、提醒人员、图样和已上传 PDF 数组均按页面语义填写。', '用户明确填写的表单与已核实候选结果', { type: 'object', required: true, constraints: ['validStatus/signNumber/name/category/loginTime/endTime/remindTime/remindUser/organizationId/address/pdfUrl必填', 'signNumber/name最多10字符，product最多500字符', 'fileUrl最多3项，pdfUrl/pdfName最多10项且数量一致'] })
const draftInput = (meaning: string): AiParameter => param(meaning, 'trademark-prepare-create 或 trademark-prepare-update.draft', { type: 'object', required: true })

add('trademark-list', base({ purpose: '读取当前用户在商标管理页面可见的商标分页列表。', effect: 'read', inputs: listInputs, output: pageOutput, consume: ['用 list[].id 作为 get、prepareUpdate、remove、续展记录和共享的唯一定位；status 只用于展示到期状态；renewable 用于决定是否允许加入续展草稿。'], steps: [{ role: 'optional', when: '需要编辑或核实写入', capabilityId: 'trademark-get', mapping: { id: 'list[].id' }, instruction: '先读取同一商标的最新详情。' }], completion: '返回当前筛选的一页商标记录和 total；查询不修改数据。', idempotency: null }))
add('trademark-get', base({ purpose: '读取一条商标的最新详情，用于编辑准备和写入回查。', effect: 'read', inputs: idInput('商标记录 ID。', 'trademark-list.list[].id'), output: detailOutput, consume: ['详情中的 fileUrl、remindUser、pdfUrl、pdfName 是后端逗号字符串；prepareUpdate 会按 Portal 编辑页还原为数组。'], steps: [], completion: '得到目标商标的最新详情快照。', idempotency: null }))
add('trademark-prepare-create', base({ purpose: '按 Portal 商标新建表单规则校验并准备尚未写入的草稿。', effect: 'prepare', inputs: { form: formInput }, output: preparationOutput('商标'), consume: ['用户取消时只丢弃 draft；确认保存时把同一 draft 传给 trademark-create。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'trademark-create', mapping: { draft: 'result.draft' }, instruction: '只提交返回的 draft；收到 ID 后回查详情和列表。' }, { role: 'cancel', when: '用户取消表单', instruction: '丢弃 draft，不调用写接口。' }], completion: '得到已校验、尚未写入的完整商标草稿。', idempotency: null }))
add('trademark-create', base({ purpose: '保存一个已准备的商标新建草稿。', effect: 'write', inputs: { draft: draftInput('trademark-prepare-create 返回的完整新建草稿。') }, output: { shape: 'string | number', fields: [field('$', 'string | number', '后端新建商标 ID；Long 可能序列化为字符串')], empty: '没有 ID 或请求抛错不能报告创建完成。' }, consume: ['SDK 按 Portal customSubmit 把日期、提醒人员、图样和 PDF 数组转换成后端字段；返回 ID 后必须按 ID 回查。'], steps: [{ role: 'required', when: '响应成功或超时', capabilityId: 'trademark-get', mapping: { id: 'result.$' }, instruction: '读取返回 ID 的详情，逐字段核对表单、日期、提醒、图样和附件；超时先回查，不要换 ID 重建。' }], completion: 'trademark-get 回查确认新记录存在且字段符合草稿后报告创建完成。', idempotency: '后端没有 requestId；超时先按返回 ID 或业务字段回查，不能盲目重复创建。' }))
add('trademark-prepare-update', base({ purpose: '基于最新商标详情和用户明确修改准备完整编辑草稿。', effect: 'prepare', inputs: { current: param('trademark-get 返回的最新详情。', 'trademark-get', { type: 'object', required: true }), changes: param('用户明确修改的表单字段；未修改字段保留 current。', '用户编辑意图', { type: 'object', required: false, nullable: true }) }, output: preparationOutput('商标'), consume: ['prepare 会把图样、提醒人员和附件逗号字符串还原为数组，再按页面规则校验；取消不调用 update。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'trademark-update', mapping: { draft: 'result.draft' }, instruction: '提交完整 draft；完成后用 trademark-get 回查。' }, { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃 draft，不调用 update。' }], completion: '得到尚未写入的完整商标编辑草稿。', idempotency: null }))
add('trademark-update', base({ purpose: '保存已准备的商标编辑草稿。', effect: 'write', inputs: { draft: draftInput('trademark-prepare-update 返回的含 id 完整草稿。') }, output: trueOutput, consume: ['提交是 Portal 的 PUT /admin-api/hr/risk/trademark/update；成功或超时后按 draft.id 读取详情，逐字段核对保存结果。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'trademark-get', mapping: { id: 'args.draft' }, instruction: '从 draft.id 回查同一商标；未确认终态前不要重复 PUT。' }], completion: '详情回查确认编辑后的字段已生效后报告更新完成。', idempotency: '无 requestId；PUT 是绝对值覆盖，超时先回查，避免覆盖他人后续修改。' }))
add('trademark-remove', base({ purpose: '删除一条商标记录。', effect: 'write', inputs: idInput('商标记录 ID；必须来自当前列表或详情。', 'trademark-list.list[].id'), output: trueOutput, consume: ['删除成功或超时后重新查询 trademark-list，确认目标 ID 不再出现；不要把 true 单独当作删除证据。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'trademark-list', instruction: '按原筛选刷新并确认目标 ID 已消失。' }, { role: 'cancel', when: '用户取消删除', instruction: '不调用 remove。' }], completion: '列表回查确认目标已消失后报告删除完成。', idempotency: '无 requestId；超时先回查列表，已删除终态不要重复发起。' }))
add('trademark-export', base({ purpose: '按商标列表筛选条件导出 Portal 页面可达的商标 Excel。', effect: 'read', inputs: Object.fromEntries(Object.entries(listInputs).filter(([key]) => !['pageNo', 'pageSize'].includes(key))), output: fileOutput, consume: ['返回文件对象供调用方保存；导出本身不代表任何写入完成。'], steps: [], completion: '得到非空商标导出文件的元数据和 Base64 内容。', idempotency: null }))
add('trademark-get-share', base({ purpose: '读取一条商标的组织、岗位、职务和人员共享设置。', effect: 'read', inputs: { resourceId: param('商标记录 ID。', 'trademark-list.list[].id', { type: 'string | number', required: true }) }, output: shareOutput, consume: ['四类数组为空表示当前没有该类共享成员；managerType 只按 Portal 原值展示，不把它当作保存参数。'], steps: [], completion: '得到商标共享设置快照。', idempotency: null }))
add('trademark-save-share', base({ purpose: '保存一条商标的组织、岗位、职务和人员共享设置。', effect: 'write', inputs: { resourceId: param('商标记录 ID。', 'trademark-list.list[].id', { type: 'string | number', required: true }), organization: param('共享组织成员数组；提交时每项只取 id。', 'trademark-get-share.organization 或用户确认选择', { type: 'object[]', required: false }), post: param('共享岗位成员数组；提交时每项只取 id。', 'trademark-get-share.post 或用户确认选择', { type: 'object[]', required: false }), duty: param('共享职务成员数组；提交时每项只取 id。', 'trademark-get-share.duty 或用户确认选择', { type: 'object[]', required: false }), user: param('共享人员成员数组；提交时每项只取 id。', 'trademark-get-share.user 或用户确认选择', { type: 'object[]', required: false }) }, output: trueOutput, consume: ['Portal 请求 type 固定为3；managerType、name 等展示字段不会发送。保存后必须重新 getShare 核对四类成员。'], steps: [{ role: 'required', when: '保存成功或超时', capabilityId: 'trademark-get-share', mapping: { resourceId: 'args.resourceId' }, instruction: '回查共享设置；未确认前不要重复覆盖保存。' }, { role: 'cancel', when: '用户取消共享设置', instruction: '不调用 saveShare。' }], completion: 'getShare 回查确认四类共享成员已生效后报告保存完成。', idempotency: '无 requestId；保存是覆盖式共享配置，超时先回查。' }))
add('trademark-renewal-records', base({ purpose: '读取一条商标的当前信息和历史续展记录。', effect: 'read', inputs: { trademarkId: param('商标记录 ID。', 'trademark-list.list[].id', { type: 'string | number', required: true }) }, output: renewalOutput, consume: ['records 按后端续展时间倒序返回；attachments 的 name/url/size 可用于展示和下载。'], steps: [], completion: '得到目标商标的续展记录快照。', idempotency: null }))
const renewalInput = param('批量续展草稿；商标 ID 不重复，content 必填最多500字符，attachments 必须1至10个且每项不超过20MB。', '用户明确续展意图与已上传附件', { type: 'object', required: true, constraints: ['trademarkIds不能为空且不能重复', 'attachments至少1个最多10个', '附件扩展名限PDF/XLS/XLSX/DOC/DOCX/JPG/JPEG/PNG'] })
add('trademark-prepare-renewal', base({ purpose: '按 Portal 批量续展表单规则校验并准备尚未提交的续展草稿。', effect: 'prepare', inputs: { trademarkIds: param('可续展商标 ID 数组；来自当前列表中 renewable 不为 false/0 的行。', '用户选择的商标列表', { type: 'object[]', required: true }), content: param('续展内容；去除首尾空格后保存，最多500字符且不能为空。', '用户填写', { type: 'string', required: true }), attachments: param('已上传续展附件数组；每项含 name/url/size。', 'Portal 上传结果', { type: 'object[]', required: true }) }, output: preparationOutput('商标续展'), consume: ['用户取消时只丢弃 draft；确认提交时把同一 draft 传给 trademark-renewal。'], steps: [{ role: 'required', when: '用户确认提交续展', capabilityId: 'trademark-renewal', mapping: { draft: 'result.draft' }, instruction: '提交同一续展 draft；返回记录 ID 后回查 trademark-renewal-records。' }, { role: 'cancel', when: '用户取消续展', instruction: '丢弃 draft，不调用续展接口。' }], completion: '得到已校验、尚未写入的续展草稿。', idempotency: null }))
add('trademark-renewal', base({ purpose: '提交已准备的批量商标续展申请。', effect: 'write', inputs: { draft: renewalInput }, output: { shape: 'string | number', fields: [field('$', 'string | number', '后端续展记录 ID；Long 可能序列化为字符串')], empty: '没有记录 ID 或请求抛错不能报告续展提交完成。' }, consume: ['Portal 请求是 POST /admin-api/hr/risk/trademark/renewal/batch；返回记录 ID 后对每个商标调用 trademark-renewal-records，确认记录内容和附件已出现。'], steps: [{ role: 'required', when: '响应成功或超时', capabilityId: 'trademark-renewal-records', mapping: { trademarkId: 'args.draft' }, instruction: '对 draft.trademarkIds 中的每个商标逐个回查续展记录；超时先回查，不要盲目重复提交。' }], completion: '所有所选商标的记录回查都包含本次续展内容和附件后报告提交完成。', idempotency: '后端没有 requestId；一次提交覆盖多个商标，超时必须按每个商标的 records 回查，确认不存在后才能重试。' }))

export const TRADEMARK_AI_CONTRACTS = contracts
export const TRADEMARK_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(TRADEMARK_METHODS).map(([id, method]) => [`trademark.${method}`, { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, '直接 SDK 方法按 inputs 接收对象参数；prepare 只产生草稿，不能被误报为已写入。'] }]))
