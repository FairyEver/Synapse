import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { BUSINESS_REGISTRATION_METHODS, businessRegistrationCapabilities } from '../capabilities/business-registration.js'

const definitions = new Map(businessRegistrationCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ bbcfc35154: app/portal/menus/hr.js、views/dashboard/hr/certificate/enterpriseRegistration.vue、list.vue、[mode]/[id].vue、change/[id]/registration-change.vue、change-record.vue、components/add-personnel.vue、components/modal-share-user/index.vue', kind: 'reference', note: '逐页核对登记信息菜单权限、列表查询/删除/导出、完整表单校验与字段转换、变更记录、人员候选和共享组件。' },
  { source: 'CodeReview_Mall_Platform_Java @ b7a359adc9e: BusinessRegistrationController、BusinessRegistrationLogController、BusinessRegistrationServiceImpl、BusinessRegistrationSaveReqVO、BusinessRegistrationLogSaveReqVO、ShareTypeEnum', kind: 'reference', note: '核对业务登记与变更记录 HTTP 方法、请求体、租户/当前用户写入、关联人员更新、共享类型和响应回执。' },
  { source: 'src/capabilities/business-registration.ts 与 test/business-registration.test.ts', kind: 'implementation', note: '锁定 Portal 请求形状、日期/附件/人员/代表人校验、变更顺序、共享成员映射和坏响应反证；不替代真实环境写入回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「风险防控 → 登记信息」列表、企业登记表单、变更记录或共享设置。',
  boundaries: [
    '页面路径是/dashboard/certificate/enterpriseRegistration/list，权限是/dashboard/certificate/enterpriseRegistration；请求使用 platform HTTP 实例和 module-type=15（风险防控），不要自行改页面上下文。',
    '列表、详情和写入都受当前会话、租户和 Portal 权限约束；SDK 不扩大可见范围，也不把 HTTP 成功或空列表当作权限证明。',
    '法定代表人分两种规则：isUnit=1 时 legalRepresentative 是 userId；isUnit=0 时发送 legalRepresentativeOutside 文本且纯数字会被 Portal 拒绝。人员关系数组里的 staffCode 是工号/未注册人员文本，不能和 userId 互换。',
    '完整新建/编辑提交对应 Portal 的 updateALL，附件 pdfUrl/pdfName 数组分别逗号连接；PDF 最多10项且名称与 URL 数量一致。永久企业 isForever=1 时 timeBusiness 发送空字符串，非永久企业必须填写 YYYY-MM-DD。',
    '变更页先 POST /business-registration-log/createBatch 写入变更记录，再按有值字段 PUT /business-registration/update 更新主表；两个请求都完成才报告变更提交完成。相同的前后值不生成变更记录。',
    '共享 type 固定为5（企业登记）；读取结果中的 managerType 仅用于展示，保存时每个组织/岗位/职务/人员成员只发送 {id}。',
  ],
  prerequisites: ['使用会话 token 和租户创建 SDK；组织、企业类型、法定代表人用户、关联人员和附件 URL 应来自 Portal 候选或已核实数据。'],
  failures: ['字段必填/长度、代表人类型、日期、附件数量、ID、变更字段、权限、租户、网络或响应形状错误会抛出；不要把 true、空回执或变更 POST 成功单独解释为最终业务成功。'],
  evidence,
  gaps: ['已完成 Portal/Java 逐页静态核对与离线请求断言；尚未在真实测试环境执行登记信息新建/编辑/变更/删除/共享及逐页回查。'],
})

const pageFields: AiField[] = [
  field('list[].id', 'string | number', '企业登记 ID；Long 可能序列化为字符串，编辑、删除、变更和共享必须原样保留'),
  field('list[].name', 'string | null', '企业名称', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].signNumber', 'string | null', '注册号或统一社会信用代码', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].organizationId', 'string | number | null', '关联组织 ID', { nullable: true, nullMeaning: '未关联组织' }),
  field('list[].type', 'string | number | null', '企业类型字典值；不要用展示名称替代', { nullable: true, nullMeaning: '未返回类型' }),
  field('list[].status', '1 | 2 | 3 | null', '登记状态；1=存续、2=注销、3=吊销', { nullable: true, values: { '1': '存续', '2': '注销', '3': '吊销' } }),
  field('list[].address', 'string | null', '住所', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].legalRepresentative', 'string | null', '本单位法人 userId 的服务端原值；不是工号', { nullable: true, nullMeaning: '非本单位法人或未返回' }),
  field('list[].legalRepresentativeOutside', 'string | null', '外部法定代表人文本', { nullable: true, nullMeaning: '本单位法人或未填写' }),
  field('list[].legalRepresentativeName', 'string | null', '服务端补充的法人名称', { nullable: true, nullMeaning: '未补充' }),
  field('list[].isUnit', 'boolean | number | null', '是否本单位法人；真值表示是', { nullable: true, values: { '0': '否', '1': '是' } }),
  field('list[].registeredCapital', 'number | string | null', '注册资本；保留服务端数字/字符串原值', { nullable: true, nullMeaning: '未填写' }),
  field('list[].establishmentTime', 'string | null', '成立日期，YYYY-MM-DD', { nullable: true, nullMeaning: '未返回' }),
  field('list[].timeBusiness', 'string | null', '营业期限截止日期；永久企业为空', { nullable: true, nullMeaning: '永久或未返回' }),
  field('list[].isForever', 'string | number | null', '是否永久企业；1=是、0=否', { nullable: true, values: { '0': '否', '1': '是' } }),
  field('list[].remindTime', 'number | null', '到期提醒提前天数；正整数', { nullable: true, nullMeaning: '未配置' }),
  field('list[].remindPost', 'string | null', '到期提醒岗位 ID/值', { nullable: true, nullMeaning: '未配置' }),
  field('list[].remindPostTree', 'string | null', '到期提醒岗位树值', { nullable: true, nullMeaning: '未配置' }),
  field('list[].scopeBusiness', 'string | null', '经营范围', { nullable: true, nullMeaning: '未填写' }),
  field('list[].registrationAuthority', 'string | null', '登记机关', { nullable: true, nullMeaning: '未填写' }),
  field('list[].shareholdingStructure', 'string | null', '股权结构', { nullable: true, nullMeaning: '未填写' }),
  field('list[].pdfName', 'string | null', 'PDF 文件名逗号串；详情会还原为数组', { nullable: true, nullMeaning: '无附件' }),
  field('list[].pdfUrl', 'string | null', 'PDF URL 逗号串；详情会还原为数组', { nullable: true, nullMeaning: '无附件' }),
  field('list[].director', 'string | null', '列表接口返回的董事关系摘要；完整数组只在详情/表单中使用', { nullable: true, nullMeaning: '未返回' }),
  field('list[].supervisor', 'string | null', '列表接口返回的监事关系摘要；完整数组只在详情/表单中使用', { nullable: true, nullMeaning: '未返回' }),
  field('list[].admin', 'string | null', '列表接口返回的高级管理人员关系摘要；完整数组只在详情/表单中使用', { nullable: true, nullMeaning: '未返回' }),
  field('list[].organizationName', 'string | null', '关联组织名称', { nullable: true, nullMeaning: '未关联或后端未补充' }),
  field('list[].creator', 'string | number | null', '创建人 ID', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].creatorName', 'string | null', '创建人名称', { nullable: true, nullMeaning: '后端未返回' }),
]

const detailFields = pageFields.filter(item => !['list[].director', 'list[].supervisor', 'list[].admin'].includes(item.path)).map(item => ({ ...item, path: item.path.replace(/^list\[\]\./, '') }))
detailFields.push(
  field('loginTime', 'string | null', '登记登录日期；服务端原值', { nullable: true, nullMeaning: '未返回' }),
  field('director', 'object[]', '董事人员关系数组；每项 staffCode 是工号或未注册人员文本'),
  field('directorOutside', 'object[]', '外部董事人员关系数组'),
  field('isDirectorOutside', 'object[]', '董事外部标记关系数组'),
  field('supervisor', 'object[]', '监事人员关系数组'),
  field('supervisorOutside', 'object[]', '外部监事人员关系数组'),
  field('isSupervisorOutside', 'object[]', '监事外部标记关系数组'),
  field('admin', 'object[]', '高级管理人员关系数组'),
  field('adminOutside', 'object[]', '外部高级管理人员关系数组'),
  field('isAdminOutside', 'object[]', '高级管理人员外部标记关系数组'),
)
for (const path of ['director', 'directorOutside', 'isDirectorOutside', 'supervisor', 'supervisorOutside', 'isSupervisorOutside', 'admin', 'adminOutside', 'isAdminOutside']) {
  detailFields.push(field(`${path}[].staffCode`, 'string | number', '人员工号；未注册人员时为页面输入文本，不是用户 ID'), field(`${path}[].staffName`, 'string | null', '人员名称', { nullable: true, nullMeaning: '后端未补充' }))
}

const trueOutput: AiContract['output'] = { shape: 'true', fields: [field('$', 'true', '后端成功回执 true')], empty: '没有 true 或请求抛错不能报告写入成功；写操作必须按 steps 回查。' }
const preparationOutput = (label: string): AiContract['output'] => ({ shape: '{ draft: object, previous?: object }', fields: [field('draft', 'object', `${label}已按 Portal 规则校验、尚未写入的草稿`), field('previous', 'object', '编辑前快照；取消时只丢弃 draft，不调用写接口', { optional: true })], empty: '字段、ID、日期、附件或人员关系不符合页面规则会在发请求前抛错。' })
const formConstraints = [
  'status 只能为 1 存续、2 注销、3 吊销；name最多20字符，signNumber最多30字符，address最多200字符',
  'organizationId、type、establishmentTime、remindTime、registrationAuthority必填；registrationAuthority最多200字符，scopeBusiness/shareholdingStructure最多1000字符',
  'isUnit=1 时 legalRepresentative 必须是正整数 userId；isUnit=0 时 legalRepresentativeOutside必填且不能是纯数字；二者不能混用',
  'isForever=0 时 timeBusiness 必填；isForever=1 时提交空字符串；日期格式为YYYY-MM-DD；remindTime为正整数',
  'pdfUrl与pdfName都是数组，均最多10项、每项非空字符串，且数量必须一致；Portal 只允许 PDF',
]

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Business registration contract has no definition: ${id}`)
  contracts[id] = value
}

const idInput = (meaning: string, source: string): Record<string, AiParameter> => ({ id: param(meaning, source, { type: 'string | number', required: true }) })
const formInput = param('Portal 企业登记完整表单；包括状态、企业基础字段、法人、期限、提醒、人员关系和 PDF 数组。', '用户明确填写的表单与已确认候选结果', { type: 'object', required: true, constraints: formConstraints })

add('business-registration-list', base({
  purpose: '按企业名称和企业类型查询当前用户可见的登记信息分页列表。', effect: 'read',
  inputs: { name: param('企业名称筛选；Portal 省略时发送空字符串，按页面筛选语义使用。', '用户输入', { type: 'string', required: false, default: '空字符串' }), type: param('企业类型字典值；不要把类型名称直接当作值。', '用户从企业类型候选中选定的 value', { type: 'string | number', required: false, default: '空字符串' }), pageNo: param('页码，从1开始。', '调用方分页位置', { type: 'number', required: false, default: '1' }), pageSize: param('每页条数；Portal 默认20。', '调用方分页设置', { type: 'number', required: false, default: '20' }) },
  output: { shape: '{ list: object[], total: number }', fields: [{ path: 'list', type: 'object[]', meaning: '当前页登记信息' }, { path: 'total', type: 'number', meaning: '符合筛选条件的总记录数，不是当前页条数' }, ...pageFields], empty: 'list=[] 且 total=0 表示当前筛选下无记录，不等同于无权限。' },
  consume: ['用 list[].id 作为详情、编辑、删除、变更和共享的唯一定位；需要完整结果时继续翻页覆盖 total。'], steps: [{ role: 'optional', when: '需要编辑或写入回查', capabilityId: 'business-registration-get', mapping: { id: 'list[].id' }, instruction: '先读取同一登记信息的最新详情。' }], completion: '返回当前页和总数；查询本身不修改数据。', idempotency: null,
}))

add('business-registration-get', base({
  purpose: '读取一个登记信息的完整详情，用于编辑前准备、变更前确认和写入回查。', effect: 'read', inputs: idInput('企业登记 ID。', 'business-registration-list.list[].id'),
  output: { shape: 'object', fields: detailFields, empty: '不存在、无权限或响应字段形状不符合 Portal 详情会抛错。' },
  consume: ['详情中的人员关系数组用于完整编辑草稿；staffCode 是工号/未注册人员文本，legalRepresentative 仍是本单位用户 ID。'], steps: [], completion: '得到目标登记信息的最新可编辑详情。', idempotency: null,
}))

add('business-registration-export', base({
  purpose: '按当前列表筛选导出企业登记 Excel 文件。', effect: 'read', inputs: { name: param('企业名称筛选。', '列表筛选', { type: 'string', required: false }), type: param('企业类型字典值。', '列表筛选', { type: 'string | number', required: false }) },
  output: { shape: '{ fileName: string, contentType: string | null, base64: string, byteLength: number }', fields: [field('fileName', 'string', 'Portal 固定下载名企业登记.xlsx；页面会覆盖 Java 响应头中的企业登记.xls'), field('contentType', 'string | null', '响应 Content-Type', { nullable: true, nullMeaning: '响应未提供' }), field('base64', 'string', '导出二进制内容的 Base64；调用方负责保存或传输'), field('byteLength', 'number', '二进制字节数')], empty: '空文件或非二进制响应会抛错；不能报告导出成功。' },
  consume: ['保存为 fileName 指定的文件名；导出只发送 name/type 筛选，不把分页参数误加入导出请求。'], steps: [], completion: '得到非空 Excel 二进制文件对象。', idempotency: null,
}))

add('business-registration-prepare-create', base({ purpose: '按 Portal 企业登记新建表单规则校验并准备未写入草稿。', effect: 'prepare', inputs: { form: formInput }, output: preparationOutput('企业登记'), consume: ['用户取消时丢弃 draft；确认保存时只把 draft 传给 create。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'business-registration-create', mapping: { draft: 'result.draft' }, instruction: '提交后按登记 ID或名称回查列表和详情。' }, { role: 'cancel', when: '用户取消表单', instruction: '丢弃 draft，不调用写接口。' }], completion: '得到已校验、尚未写入的完整企业登记草稿。', idempotency: null }))
add('business-registration-create', base({ purpose: '保存一个已准备的新建企业登记草稿。', effect: 'write', inputs: { draft: param('prepareCreate 返回的完整草稿。', 'business-registration-prepare-create.draft', { type: 'object', required: true }) }, output: { shape: 'string | number', fields: [field('$', 'string | number', '后端新建登记 ID')], empty: '没有 ID 或请求抛错不能报告创建完成。' }, consume: ['Portal 使用 /create；SDK 会把人员数组和 PDF 数组按页面协议发送。返回 ID 后必须回查 list/get。'], steps: [{ role: 'required', when: '响应成功或超时', capabilityId: 'business-registration-get', mapping: { id: 'result.$' }, instruction: '读取返回 ID，逐字段核对基础字段、法人类型、期限、人员和附件。' }], completion: '详情回查确认新登记已出现且字段符合目标。', idempotency: '没有后端 requestId；超时先按返回 ID或唯一名称回查，不换请求盲目重建。' }))
add('business-registration-prepare-update', base({ purpose: '基于最新详情和用户明确修改准备完整企业登记编辑草稿。', effect: 'prepare', inputs: { current: param('business-registration-get 返回的最新详情。', 'business-registration-get', { type: 'object', required: true }), changes: param('用户明确修改的字段；未提供字段保留 current。', '用户编辑意图', { type: 'object', required: false, nullable: true }) }, output: preparationOutput('企业登记'), consume: ['prepare 会把详情中的逗号串附件还原为数组；legalRepresentative 不要改成 staffCode。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'business-registration-update', mapping: { draft: 'result.draft' }, instruction: '提交完整 draft，完成后 get 回查。' }, { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃 draft，不调用 update。' }], completion: '得到含原 ID、已校验且尚未写入的完整草稿。', idempotency: null }))
add('business-registration-update', base({ purpose: '保存完整企业登记编辑草稿。', effect: 'write', inputs: { draft: param('prepareUpdate 返回的含 id 完整草稿。', 'business-registration-prepare-update.draft', { type: 'object', required: true }), 'draft.id': param('编辑草稿中的企业登记 ID；从 draft 取出作为回查定位。', 'business-registration-prepare-update.draft.id', { type: 'string | number', required: true }) }, output: trueOutput, consume: ['Portal 对完整表单使用 updateALL；返回 true 后必须按 draft.id 读取详情逐字段核对。'], steps: [{ role: 'required', when: '响应成功或超时', capabilityId: 'business-registration-get', mapping: { id: 'args.draft.id' }, instruction: '从草稿中取出同一登记 ID 回查，确认修改字段和未修改关系数组没有被意外清空。' }], completion: '详情回查确认编辑终态与草稿一致。', idempotency: '没有 requestId；超时先回查，不盲目覆盖他人后续修改。' }))
add('business-registration-remove', base({ purpose: '删除一条企业登记记录。', effect: 'write', inputs: idInput('企业登记 ID，必须来自当前列表。', 'business-registration-list.list[].id'), output: trueOutput, consume: ['返回 true 后刷新列表，确认目标 ID 消失；请求超时也先回查。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'business-registration-list', instruction: '回查列表确认目标不再可见。' }, { role: 'cancel', when: '用户取消删除确认', instruction: '不调用 remove。' }], completion: '列表回查确认目标已删除。', idempotency: '没有 requestId；删除超时先回查，不能用空回执猜测终态。' }))

add('business-registration-prepare-change', base({ purpose: '校验并准备登记信息变更记录及主表同步字段。', effect: 'prepare', inputs: { businessRegistrationId: param('企业登记 ID。', 'business-registration-list.list[].id', { type: 'string | number', required: true }), dateRegistration: param('变更日期，YYYY-MM-DD。', '用户选择日期', { type: 'string', required: true, format: 'YYYY-MM-DD' }), entries: param('页面允许的变更记录数组；支持名称、统一信用代码、住所、法人、注册资本、成立日期、营业期限、经营范围、登记机关、董事、监事、关联组织、类型、高级管理人员、股权结构、附件；普通字段 before/after 可为字符串或有限数字。', '用户在变更页选择字段后的 before/after 或附件数组', { type: 'object[]', required: false }), update: param('同步更新企业主表的部分字段；仅传页面实际变更字段。', '变更页表单结果', { type: 'object', required: false, nullable: true }) }, output: { shape: '{ draft: object }', fields: [field('draft', 'object', '含 businessRegistrationId、dateRegistration、createReqVO 和 update 的已校验草稿')], empty: '日期、变更字段或请求形状不符合页面规则会抛错；相同 before/after 不允许生成普通变更记录。' }, consume: ['企业字段变更和变更记录是同一次页面提交的两个目标；只准备不发请求。'], steps: [{ role: 'required', when: '用户确认提交变更', capabilityId: 'business-registration-submit-change', mapping: { draft: 'result.draft' }, instruction: '先写变更记录，再更新主表，完成后 get/get-change-record 回查。' }, { role: 'cancel', when: '用户取消变更', instruction: '丢弃 draft，不调用写接口。' }], completion: '得到可按 Portal 顺序提交的变更草稿。', idempotency: null }))
add('business-registration-submit-change', base({ purpose: '提交登记信息变更：先创建变更日志，再更新登记主表。', effect: 'write', inputs: { draft: param('prepareChange 返回的变更草稿。', 'business-registration-prepare-change.draft', { type: 'object', required: true }), 'draft.businessRegistrationId': param('变更草稿中的企业登记 ID；用于两步提交后的回查。', 'business-registration-prepare-change.draft.businessRegistrationId', { type: 'string | number', required: true }) }, output: trueOutput, consume: ['有 createReqVO 时先 POST /business-registration-log/createBatch；有 update 字段时再 PUT /business-registration/update。只完成第一步不能报告整单成功。'], steps: [{ role: 'required', when: '提交完成或响应不确定', capabilityId: 'business-registration-get', mapping: { id: 'args.draft.businessRegistrationId' }, instruction: '从草稿中取出同一企业登记 ID，读取主表核对企业字段更新。' }, { role: 'required', when: '提交完成或响应不确定且存在 createReqVO', capabilityId: 'business-registration-get-change-record', mapping: { id: 'args.draft.businessRegistrationId' }, instruction: '从草稿中取出同一企业登记 ID，读取变更记录核对新批次；若第一步成功第二步失败，不要重复创建日志。' }], completion: '主表和变更记录按目标字段都回查一致。', idempotency: '没有 requestId，且两步不是原子事务；异常时先分别回查主表与变更记录，再决定补偿动作。' }))
add('business-registration-get-change-record', base({ purpose: '读取指定企业登记的变更记录页数据。', effect: 'read', inputs: idInput('企业登记 ID。', 'business-registration-list.list[].id'), output: { shape: '{ head: string[], headValue: object | null, body: object[] }', fields: [field('head', 'string[]', '变更记录表头字段名'), field('headValue', 'object | null', '当前企业登记主表快照；可为空', { nullable: true, nullMeaning: '后端未返回主表快照' }), field('body', 'object[]', '变更明细记录数组'), field('body[].id', 'string | number', '变更明细 ID；同一 createTime 批次删除时一起提交'), field('body[].detailsRegistration', 'string | null', '变更字段名称', { nullable: true, nullMeaning: '后端未返回' }), field('body[].beforeField', 'string | null', '变更前文本', { nullable: true, nullMeaning: '附件或未返回' }), field('body[].afterField', 'string | null', '变更后文本', { nullable: true, nullMeaning: '附件或未返回' }), field('body[].pdfName', 'string | null', '附件名称逗号串', { nullable: true, nullMeaning: '非附件变更' }), field('body[].pdfUrl', 'string | null', '附件 URL 逗号串', { nullable: true, nullMeaning: '非附件变更' }), field('body[].createTime', 'string | null', '记录创建时间；页面按此分组批次', { nullable: true, nullMeaning: '后端未返回' })], empty: 'body=[] 表示当前登记没有变更记录，不等同于请求失败。' }, consume: ['编辑或删除时按同一 createTime 批次处理；单条 id 不能代表整个页面删除批次。'], steps: [], completion: '得到当前登记的主表快照和变更明细。', idempotency: null }))
add('business-registration-remove-change-record', base({ purpose: '删除变更记录页选中的同一批次记录。', effect: 'write', inputs: { ids: param('同一 createTime 批次的变更明细 ID 数组。', 'business-registration-get-change-record.body[].id', { type: 'string[] | number[]', required: true, constraints: ['非空', '应包含同一批次全部 ID'] }) }, output: trueOutput, consume: ['Portal DELETE body 是 ID 数组，返回空回执；完成后重新读取变更记录确认该批次消失。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'business-registration-get-change-record', instruction: '回查并确认提交的 ID 不再出现。' }, { role: 'cancel', when: '用户取消删除变更记录', instruction: '不调用 removeChangeRecord。' }], completion: '变更记录回查确认目标批次已删除。', idempotency: '没有 requestId；超时先回查，不重复删除仍存在的批次。' }))

const shareFields = ['organization', 'post', 'duty', 'user']
add('business-registration-get-share', base({ purpose: '读取企业登记的共享设置。', effect: 'read', inputs: { resourceId: param('企业登记 ID。', 'business-registration-list.list[].id', { type: 'string | number', required: true }) }, output: { shape: '{ organization: object[], post: object[], duty: object[], user: object[] }', fields: shareFields.flatMap(key => [field(key, 'object[]', `${key} 共享成员数组`), field(`${key}[].id`, 'string | number', `${key} 成员 ID`), field(`${key}[].managerType`, 'number | null', 'Portal 读取可能返回的管理类型；保存企业登记时不回传', { nullable: true, nullMeaning: '响应未提供' })]), empty: '四类数组为空表示当前共享设置没有该类成员，不等同于无权限。' }, consume: ['读取 managerType 只用于展示或后续选择；保存时必须只保留成员 id。'], steps: [{ role: 'optional', when: '用户确认调整共享', capabilityId: 'business-registration-save-share', mapping: { resourceId: 'args.resourceId', organization: 'result.organization', post: 'result.post', duty: 'result.duty', user: 'result.user' }, instruction: '让用户确认成员后提交，完成后重新读取共享设置。' }], completion: '得到当前 type=5 的四类共享成员。', idempotency: null }))
add('business-registration-save-share', base({ purpose: '保存企业登记共享设置。', effect: 'write', inputs: { resourceId: param('企业登记 ID。', 'business-registration-list.list[].id', { type: 'string | number', required: true }), organization: param('共享组织成员；每项至少含 id。', '用户选择的组织成员', { type: 'object[]', required: false }), post: param('共享岗位成员；每项至少含 id。', '用户选择的岗位成员', { type: 'object[]', required: false }), duty: param('共享职务成员；每项至少含 id。', '用户选择的职务成员', { type: 'object[]', required: false }), user: param('共享人员成员；每项至少含 id。', '用户选择的人员成员', { type: 'object[]', required: false }) }, output: trueOutput, consume: ['请求固定发送 type=5、resourceId 和四类 *Ids；每个成员只保留 {id}，不会把 managerType 发给 Portal。true 后必须 get-share 回查。'], steps: [{ role: 'required', when: '保存成功或超时', capabilityId: 'business-registration-get-share', mapping: { resourceId: 'args.resourceId' }, instruction: '回查四类成员与目标一致后才报告共享保存完成。' }, { role: 'cancel', when: '用户取消共享设置', instruction: '不调用 saveShare。' }], completion: '共享设置回查确认四类成员终态一致。', idempotency: '没有 requestId；超时先读取共享设置，不换 payload 盲目重发。' }))

export const BUSINESS_REGISTRATION_AI_CONTRACTS = contracts
export const BUSINESS_REGISTRATION_METHOD_CONTRACTS: Record<string, AiContract> = {}
for (const [id, method] of Object.entries(BUSINESS_REGISTRATION_METHODS)) {
  const contract = contracts[id]!
  BUSINESS_REGISTRATION_METHOD_CONTRACTS[`businessRegistration.${method}`] = { ...contract, boundaries: [...contract.boundaries, `这是公开门面 sdk.businessRegistration.${method}；invoke 使用 capabilityId=${id}。`] }
}
