import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { CERTIFICATE_LICENSE_METHODS, certificateLicenseCapabilities } from '../capabilities/certificate-license.js'

const definitions = new Map(certificateLicenseCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const recordFields: AiField[] = [
  field('id', 'string | number', '证照或文件夹 ID；Long 可能序列化为字符串，编辑、删除和共享必须原样保留'),
  field('pid', 'string | number | null', '父级文件夹 ID', { nullable: true, nullMeaning: '根目录或后端未返回' }),
  field('parentId', 'string | number | null', 'Portal 树渲染使用的父级 ID', { nullable: true, nullMeaning: '根目录或后端未返回' }),
  field('type', '1 | 2 | null', '节点类型；1=文件夹，2=证照', { nullable: true, values: { '1': '文件夹', '2': '证照' } }),
  field('name', 'string | null', '文件夹名称或证照名称', { nullable: true, nullMeaning: '后端未返回名称' }),
  field('category', 'string | number | null', '证照类型 ID；文件夹通常为空', { nullable: true, nullMeaning: '文件夹或未关联类型' }),
  field('categoryName', 'string | null', '证照类型名称', { nullable: true, nullMeaning: '文件夹或类型已删除' }),
  field('fileUrlList', 'string[]', '证照图片 URL 列表；Portal 最多上传1张', { constraints: ['仅对证照节点有意义'] }),
  field('pdfUrlList', 'string[]', '证照 PDF 附件 URL 列表；Portal 最多10项'),
  field('pdfNameList', 'string[]', '与 pdfUrlList 按下标对应的附件名称列表'),
  field('legalName', 'string | null', '法定代表人名称；本单位人员取人员候选名称，否则为外部录入文本', { nullable: true, nullMeaning: '未填写或后端未返回' }),
  field('legalCode', 'string | null', '本单位法定代表人员工号；不是 userId', { nullable: true, nullMeaning: '外部法人或未选择' }),
  field('isOur', '0 | 1 | null', '是否本单位人员；1是、0否', { nullable: true, values: { '0': '否', '1': '是' } }),
  field('perpetual', '0 | 1 | null', '是否永久有效；1是、0否', { nullable: true, values: { '0': '否', '1': '是' } }),
  field('organizationId', 'string | number | null', '关联组织 ID', { nullable: true, nullMeaning: '未关联组织' }),
  field('startTime', 'string | null', '取得日期，YYYY-MM-DD', { nullable: true, nullMeaning: '后端未返回' }),
  field('endTime', 'string | null', '到期日期，YYYY-MM-DD', { nullable: true, nullMeaning: '永久证照或后端未返回' }),
  field('remindUserCode', 'string | null', '到期提醒人员工号逗号串；编辑时转换为人员候选数组', { nullable: true, nullMeaning: '未配置提醒人员' }),
  field('remindUserList', 'string[]', '到期提醒人员名称，和 remindUserCode 按顺序对应'),
  field('expireStatus', 'number | null', '过期状态；0正常、1即将到期、2已过期，文件夹为空', { nullable: true, values: { '0': '正常', '1': '即将到期', '2': '已过期' } }),
  field('childrenCount', 'number | string | null', '文件夹下递归证照数量；没有子节点的树叶由 Portal 映射为空字符串', { nullable: true, nullMeaning: '接口未返回' }),
]

const treeOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('[]', 'object', 'Portal 证照目录树节点'), ...recordFields.map(item => ({ ...item, path: `[].${item.path}` })), field('[].children', 'object[]', '有子节点的文件夹递归树', { optional: true })],
  empty: '[] 表示当前用户权限、名称筛选和租户范围下没有可见文件夹或证照；权限、会话、网络或响应形状错误会抛出，不降级为空树。',
}

const categoryOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [field('[]', 'object', '可选证照类型'), field('[].id', 'string | number', '证照类型 ID'), field('[].name', 'string', '证照类型名称'), field('[].remindTime', 'number | null', '该类型的提前提醒天数', { nullable: true, nullMeaning: '未配置' }), field('[].count', 'number | null', '该类型当前证照数量', { nullable: true, nullMeaning: '后端未返回' }), field('[].tipTemplateId', 'string | number | null', '证照识别提示模板 ID', { nullable: true, nullMeaning: '未绑定模板' })],
  empty: '[] 表示当前租户没有可选证照类型；不能自行猜测 category ID。',
}

const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', 'Portal 后端 CommonResult<Boolean> 的成功值')],
  empty: '没有 true 或请求抛错都不能报告保存、删除或共享成功；写操作必须按 steps 回查。',
}

const preparationOutput = (label: string): AiContract['output'] => ({
  shape: '{ draft: object, previous?: object }',
  fields: [field('draft', 'object', `${label}尚未写入的已校验草稿`), field('previous', 'object', '编辑前快照；取消时只丢弃 draft，不调用写接口', { optional: true })],
  empty: '表单字段、ID、日期、附件或当前详情不符合 Portal 规则会在发请求前抛错。',
})

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ bbcfc35154: app/portal/menus/hr.js、views/dashboard/hr/certificate/certificate.vue、list.vue、[mode]/[id].vue、actions/upload-certificate.vue、components/staff-select.vue、components/modal.vue', kind: 'reference', note: '逐页核对风险防控 module-type、目录树筛选、文件夹/证照按钮、上传/识别/共享入口、表单校验、数组转逗号串和 PDF/图片规则。' },
  { source: 'CodeReview_Mall_Platform_Java @ b7a359adc9e: HrLicenseController、HrLicenseServiceImpl、HrLicenseRespVO、HrLicenseSaveReqVO、HrLicensePageRepVO、HrShareUserController、HrShareUserSaveVO', kind: 'reference', note: '核对树、详情、证照类型、创建/更新/文件夹/删除、识别/模板、共享端点、租户和资源权限，以及删除文件夹前必须清空子证照。' },
  { source: 'src/capabilities/certificate-license.ts 与 test/certificate-license.test.ts', kind: 'implementation', note: '锁定 Portal 请求体、表单转换、目录树映射、附件/日期/人员校验、共享和坏响应反证；不替代真实环境写入回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作 Portal「风险防控 → 证照管理」的目录树、文件夹、证照表单、识别或共享入口。',
  boundaries: [
    '页面权限是/dashboard/certificate/certificate；请求使用 platform HTTP 实例和 module-type=15（风险防控）。',
    'Portal 树接口按当前会话租户、创建人、证照资源授权和名称筛选返回；空树不是权限成功。文件夹删除会递归检查，文件夹内有证照时后端拒绝删除。',
    '证照表单的 category、pid、organizationId、name、startTime 必填；非永久证照还必须有 endTime 和 remindUserCode。isOur=1 时 legalCode 来自带关键字的人员候选，不能把工号或姓名猜成用户 ID。',
    '图片和 PDF 至少上传一种；图片最多1张，PDF 最多10项，PDF 只能是 application/pdf。提交时 URL 和文件名分别按逗号连接，永久证照发送 endTime=null。',
    '共享组件对证照的 type 固定为2；保存组织、岗位、职务和人员时每项只提交 {id}，读取响应中的 managerType 不会回传为保存字段。',
    '保存、删除和共享接口无 requestId；超时先回查目录/详情/共享设置，不要盲目重复提交。取消是本地丢弃草稿，没有服务端 cancel。',
  ],
  prerequisites: ['使用当前用户会话、租户和页面权限创建 SDK；证照类型、父级目录、组织、法人/提醒人员和上传 URL 必须来自对应 Portal 候选或已核实结果。'],
  failures: ['表单规则、ID、日期、附件、重复名称、资源授权、文件夹非空删除、权限、租户、网络或响应形状错误原样抛出；不把空树、空列表或 HTTP 成功当作写入证据。'],
  evidence,
  gaps: ['已完成 Portal/Java 逐页静态核对与离线请求断言；尚未在真实测试环境执行目录、证照保存、识别、共享及删除回查。'],
})

const definitionsById = new Map(certificateLicenseCapabilities.map(definition => [definition.id, definition]))
const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitionsById.has(id)) throw new Error(`Certificate license contract has no definition: ${id}`)
  contracts[id] = value
}

const listInput = { name: param('证照或文件夹名称筛选；省略时发送空字符串。', '用户明确输入的名称筛选', { type: 'string', required: false, default: '空字符串' }) }
const idInput = (meaning: string, source: string): Record<string, AiParameter> => ({ id: param(meaning, source, { type: 'string | number', required: true }) })
const formInput = param('Portal 证照表单对象；包含证照类型、父级目录、关联组织、法人、提醒人员、日期和已上传 URL。', '用户明确填写的证照表单和候选结果', { type: 'object', required: true, constraints: ['name最多50字符', 'fileUrl最多1项、pdfUrl最多10项', '图片或PDF至少一类', '非永久证照需endTime和提醒人员'] })
const folderInput = param('Portal 文件夹表单对象；包含非空名称、可选父目录和角色授权 ID 数组。', '用户明确填写的文件夹表单', { type: 'object', required: true, constraints: ['name最多50字符', '保存时type固定为1', '根目录父级发送0'] })

add('certificate-license-list', base({
  purpose: '读取当前用户在证照管理页面可见的文件夹和证照目录树。', effect: 'read', inputs: listInput, output: treeOutput,
  consume: ['type=1 的节点可继续创建下级目录或下级证照；type=2 的节点可编辑证照、共享或删除。', '编辑证照前调用 get 取得最新详情，不要把树节点的展示字段当作完整表单。'],
  steps: [], completion: '返回当前名称筛选下的目录树；读取不修改证照。', idempotency: null,
}))

add('certificate-license-get', base({
  purpose: '读取一个证照或文件夹的最新详情，用于编辑前准备和写入回查。', effect: 'read', inputs: idInput('证照或文件夹 ID。', 'certificate-license-list[].id'), output: { shape: 'object', fields: recordFields, empty: '不存在、无权限或响应字段错误会抛出。' },
  consume: ['type=1 时取 roleIds 作为角色授权；type=2 时取 fileUrlList、pdfUrlList、pdfNameList、legalCode、remindUserCode 和日期组成编辑草稿。'], steps: [], completion: '得到一个可核对的最新节点详情。', idempotency: null,
}))

add('certificate-license-category-list', base({
  purpose: '读取新建/编辑证照表单的证照类型候选。', effect: 'read', inputs: {}, output: categoryOutput, consume: ['把返回的 id 作为 category；不要用类型名称替代 ID。'], steps: [], completion: '返回当前租户的证照类型候选。', idempotency: null,
}))

add('certificate-license-prepare-create-folder', base({ purpose: '校验并准备新建证照文件夹草稿。', effect: 'prepare', inputs: { form: folderInput }, output: preparationOutput('文件夹'), consume: ['用户取消时丢弃 draft，不调用 createFolder。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'certificate-license-create-folder', mapping: { draft: 'result.draft' }, instruction: '只提交返回的 draft；完成后回查 list。' }, { role: 'cancel', when: '用户点击取消', instruction: '丢弃 draft，不调用写接口。' }], completion: '得到已校验、尚未写入的文件夹草稿。', idempotency: null }))
add('certificate-license-create-folder', base({ purpose: '创建证照管理文件夹。', effect: 'write', inputs: { draft: param('prepareCreateFolder 返回的文件夹草稿。', 'certificate-license-prepare-create-folder.draft', { type: 'object', required: true }) }, output: { shape: 'string | number', fields: [field('$', 'string | number', '后端新建文件夹 ID')], empty: '无 ID 或请求抛错不能报告创建成功。' }, consume: ['返回 ID 后调用 list，核对名称、父目录和可见性。'], steps: [{ role: 'required', when: '创建成功或响应超时', capabilityId: 'certificate-license-list', mapping: { name: 'user.parentOrFolderName' }, instruction: '回查目录树；超时先回查，不要直接重试。' }], completion: '目录回查确认文件夹已出现。', idempotency: '无 requestId；重复名称由后端拒绝，超时先回查。' }))
add('certificate-license-prepare-update-folder', base({ purpose: '基于最新文件夹详情准备编辑草稿。', effect: 'prepare', inputs: { current: param('certificate-license-get 返回的文件夹详情。', 'certificate-license-get', { type: 'object', required: true }), changes: param('用户明确修改的 name、pid 或 roleList。', '用户编辑意图', { type: 'object', required: false, nullable: true }) }, output: preparationOutput('文件夹'), consume: ['取消时丢弃 draft；确认后提交 updateFolder。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'certificate-license-update-folder', mapping: { draft: 'result.draft' }, instruction: '提交草稿并回查目录树。' }, { role: 'cancel', when: '用户点击取消', instruction: '不调用 updateFolder。' }], completion: '得到尚未写入的文件夹编辑草稿。', idempotency: null }))
add('certificate-license-update-folder', base({ purpose: '保存已准备的证照文件夹编辑草稿。', effect: 'write', inputs: { draft: param('prepareUpdateFolder 返回的含 id 文件夹草稿。', 'certificate-license-prepare-update-folder.draft', { type: 'object', required: true }) }, output: trueOutput, consume: ['成功或超时后调用 get/list 核对名称、父目录和角色授权。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'certificate-license-get', mapping: { id: 'args.draft' }, instruction: '从 draft.id 回查同一文件夹；未确认终态前不要重试。' }], completion: '详情回查确认文件夹字段已生效。', idempotency: '无 requestId；PUT 覆盖写，超时先回查。' }))

add('certificate-license-prepare-create', base({ purpose: '校验并准备新建证照表单草稿。', effect: 'prepare', inputs: { form: formInput }, output: preparationOutput('证照'), consume: ['legalCode/remindUserCode 必须是候选人员对象；fileUrl/pdfUrl 必须是已上传 URL。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'certificate-license-create', mapping: { draft: 'result.draft' }, instruction: '提交后回查目录树和详情。' }, { role: 'cancel', when: '用户点击取消', instruction: '丢弃 draft，不调用 create。' }], completion: '得到已校验、尚未写入的证照草稿。', idempotency: null }))
add('certificate-license-create', base({ purpose: '保存一个已准备的新建证照表单。', effect: 'write', inputs: { draft: param('prepareCreate 返回的证照草稿。', 'certificate-license-prepare-create.draft', { type: 'object', required: true }) }, output: trueOutput, consume: ['后端会把人员数组转换为工号字符串，把 URL 数组转换为逗号串；返回 true 后必须 list/get 回查。'], steps: [{ role: 'required', when: '保存成功或响应超时', capabilityId: 'certificate-license-list', instruction: '回查名称、category、organizationId、日期、附件和提醒人员；不要只看 true。' }], completion: '目录和详情回查确认新证照已出现且字段一致。', idempotency: '无 requestId；重复名称由后端拒绝，超时先回查。' }))
add('certificate-license-prepare-update', base({ purpose: '基于最新证照详情和用户修改准备完整编辑草稿。', effect: 'prepare', inputs: { current: param('certificate-license-get 返回的最新证照详情。', 'certificate-license-get', { type: 'object', required: true }), changes: param('用户明确修改的表单字段；未修改字段保留 current。', '用户编辑意图', { type: 'object', required: false, nullable: true }) }, output: preparationOutput('证照'), consume: ['prepare 会把提醒人员逗号串和附件逗号串还原为表单数组；确认后再调用 update。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'certificate-license-update', mapping: { draft: 'result.draft' }, instruction: '提交完整 draft；完成后 get 回查。' }, { role: 'cancel', when: '用户点击取消', instruction: '只丢弃 draft，不调用 update。' }], completion: '得到尚未写入的完整证照编辑草稿。', idempotency: null }))
add('certificate-license-update', base({ purpose: '保存已准备的证照编辑草稿。', effect: 'write', inputs: { draft: param('prepareUpdate 返回的含 id 完整证照草稿。', 'certificate-license-prepare-update.draft', { type: 'object', required: true }) }, output: trueOutput, consume: ['成功或超时后按 draft.id 调用 get，逐字段核对附件、法人、提醒人员和日期。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'certificate-license-get', mapping: { id: 'args.draft' }, instruction: '从 draft.id 回查同一证照详情；未确认前不要重复 PUT。' }], completion: '详情回查确认编辑后的证照字段已生效。', idempotency: '无 requestId；PUT 覆盖写，超时先回查。' }))
add('certificate-license-remove', base({ purpose: '删除证照或文件夹。', effect: 'write', inputs: idInput('证照或文件夹 ID；必须来自当前目录树。', 'certificate-license-list[].id'), output: trueOutput, consume: ['文件夹内仍有证照时后端会拒绝；成功或超时后刷新 list 核对目标消失。'], steps: [{ role: 'required', when: '用户确认删除或响应超时', capabilityId: 'certificate-license-list', instruction: '回查目录树，确认目标及其允许删除的子树已不可见。' }, { role: 'cancel', when: '用户取消删除', instruction: '不调用 remove。' }], completion: '目录回查确认删除终态。', idempotency: '无 requestId；删除超时先回查，已删除终态不要重复发起。' }))
add('certificate-license-tip-template', base({ purpose: '检查所选证照类型是否配置了识别提示模板。', effect: 'read', inputs: { categoryId: param('证照类型 ID。', 'certificate-license-category-list[].id', { type: 'string | number', required: true }) }, output: { shape: 'boolean', fields: [field('$', 'boolean', '是否存在识别模板；false 时 Portal 禁用识别按钮')], empty: '后端未返回时按 false；权限或网络错误仍抛出。' }, consume: ['只有 true 时才调用 pictureRecognition；不能把 false 当作识别失败。'], steps: [], completion: '得到当前类型是否可识别的布尔值。', idempotency: null }))
add('certificate-license-picture-recognition', base({ purpose: '用已上传的第一张证照图片和类型调用 Portal 证照识别。', effect: 'write', inputs: { imgUrl: param('已上传图片 URL；Portal 只取第一张。', 'base-upload-file 返回 URL', { type: 'string', required: true }), type: param('证照类型 ID。', 'certificate-license-category-list[].id', { type: 'string | number', required: true }) }, output: { shape: 'object', fields: [field('name', 'string | null', '识别出的证照名称', { nullable: true, nullMeaning: 'AI 未识别' }), field('startTime', 'string | null', '识别出的取得日期', { nullable: true, nullMeaning: 'AI 未识别' }), field('endTime', 'string | null', '识别出的到期日期', { nullable: true, nullMeaning: 'AI 未识别或永久' }), field('perpetual', 'string | number | null', '识别出的永久标记原值', { nullable: true, nullMeaning: 'AI 未返回' })], empty: '识别异常会抛错；不要把异常当成空表单已识别。' }, consume: ['把结果作为待确认表单初值，必须由用户确认后再 prepareCreate/prepareUpdate；识别结果不是写入证据。'], steps: [], completion: '返回待人工确认的识别结果。', idempotency: null }))
add('certificate-license-get-share', base({ purpose: '读取证照资源的组织、岗位、职务和人员共享设置。', effect: 'read', inputs: { resourceId: param('证照 ID。', 'certificate-license-list[].id', { type: 'string | number', required: true }) }, output: { shape: '{ organization: object[], post: object[], duty: object[], user: object[] }', fields: [field('organization', 'object[]', '共享组织及管理类型'), field('post', 'object[]', '共享岗位及管理类型'), field('duty', 'object[]', '共享职务及管理类型'), field('user', 'object[]', '共享人员及管理类型')], empty: '没有共享成员时四个数组为空；权限或网络错误仍抛出。' }, consume: ['把成员 id 作为共享选择结果；managerType 是 Portal 原值，不要猜成权限角色。'], steps: [], completion: '取得当前证照共享设置快照。', idempotency: null }))
add('certificate-license-save-share', base({ purpose: '保存证照的组织、岗位、职务和人员共享设置。', effect: 'write', inputs: { resourceId: param('证照 ID。', 'certificate-license-list[].id', { type: 'string | number', required: true }), organization: param('共享组织成员数组；提交时只取每项 id。', 'certificate-license-get-share.organization 或用户确认选择', { type: 'object[]', required: false }), post: param('共享岗位成员数组；提交时只取每项 id。', 'certificate-license-get-share.post 或用户确认选择', { type: 'object[]', required: false }), duty: param('共享职务成员数组；提交时只取每项 id。', 'certificate-license-get-share.duty 或用户确认选择', { type: 'object[]', required: false }), user: param('共享人员成员数组；提交时只取每项 id。', 'certificate-license-get-share.user 或用户确认选择', { type: 'object[]', required: false }) }, output: trueOutput, consume: ['保存后重新 getShare，核对四类成员；Portal 的 type 固定为2，调用方不能用它切换资源类型，managerType 不会提交。'], steps: [{ role: 'required', when: '保存成功或响应超时', capabilityId: 'certificate-license-get-share', mapping: { resourceId: 'args.resourceId' }, instruction: '回查共享设置；未确认前不要重复保存。' }, { role: 'cancel', when: '用户取消共享设置', instruction: '不调用 saveShare。' }], completion: '共享设置回查确认已生效。', idempotency: '无 requestId；保存是覆盖式共享配置，超时先回查。' }))

export const CERTIFICATE_LICENSE_AI_CONTRACTS = contracts
export const CERTIFICATE_LICENSE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(CERTIFICATE_LICENSE_METHODS).map(([id, method]) => [
    `certificateLicense.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, '直接 SDK 方法按 inputs 接收对象参数；prepare 只产生草稿，不能被误报为已写入。'] },
  ]),
)
