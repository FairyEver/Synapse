import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { COMPANY_POLICY_METHODS, companyPolicyCapabilities } from '../capabilities/company-policy.js'

const definitions = new Map(companyPolicyCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const rowFields: AiField[] = [
  field('id', 'string | number', '制度或文件夹 ID；Long 可能序列化为字符串，所有后续动作原样使用', { source: 'Portal/Java HrPolicyRespVO.id' }),
  field('pid', 'string | number | null', '父文件夹 ID；根节点为null或0，prepare会按对应Portal表单转换', { nullable: true, nullMeaning: '根目录或后端未返回' }),
  field('type', '1 | 2', '节点类型；1=文件夹，2=制度', { values: { '1': '文件夹', '2': '制度' } }),
  field('name', 'string | null', '文件夹或制度名称；文件上传时来自OSS文件名', { nullable: true, nullMeaning: '后端未返回' }),
  field('category', 'string | number | null', '制度类型 ID', { nullable: true, nullMeaning: '文件夹或未关联制度类型' }),
  field('categoryName', 'string | null', '制度类型名称', { nullable: true, nullMeaning: '文件夹、未关联或后端未返回' }),
  field('fileUrl', 'string | null', '制度文件 URL；下载能力会把http提升为https', { nullable: true, nullMeaning: '文件夹或无文件' }),
  field('roleIds', 'string[] | number[]', '文件夹或制度的角色授权 ID；响应缺失时为空数组', { optional: true }),
  field('creator', 'string | number | null', '创建人 ID', { nullable: true, nullMeaning: '后端未返回' }),
  field('creatorName', 'string | null', '创建人名称', { nullable: true, nullMeaning: '后端未返回' }),
  field('statics', 'number | null', '制度阅读人数；点击列表数字进入学习人员分页', { nullable: true, nullMeaning: '文件夹或后端未返回' }),
  field('isRead', '0 | 1 | null', '当前用户是否已学习；1=是、0=否', { nullable: true, nullMeaning: '后端未返回' }),
  field('isNeedRead', '0 | 1 | null', '当前用户是否需要学习；1=不需要、0=需要', { nullable: true, nullMeaning: '后端未返回' }),
  field('createTime', 'string | null', '创建时间原值', { nullable: true, nullMeaning: '后端未返回' }),
  field('childrenCount', 'number | null', '子节点数量', { nullable: true, nullMeaning: '后端未返回' }),
  field('organizationId', 'string | number | null', '关联组织 ID；上传制度表单必填', { nullable: true, nullMeaning: '未关联或后端未返回' }),
  field('organizationName', 'string | null', '关联组织名称', { nullable: true, nullMeaning: '未关联或后端未返回' }),
  field('directoryList', 'object[]', '制度目录；每项含目录名称、目录内容和章节数组', { optional: true }),
  field('directoryList[].directoryName', 'string | null', '目录名称；编辑/保存时由Portal按序生成“第X章”', { nullable: true, nullMeaning: '后端未返回' }),
  field('directoryList[].directoryContent', 'string | null', '目录内容；已有目录项必填且最多50字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('directoryList[].chapterList', 'object[]', '该目录下的章节数组'),
  field('directoryList[].chapterList[].chapterName', 'string | null', '章节名称；保存时由Portal按序生成“第X节”', { nullable: true, nullMeaning: '后端未返回' }),
  field('directoryList[].chapterList[].chapterContent', 'string | null', '章节内容；已有章节项必填且最多50字符', { nullable: true, nullMeaning: '后端未返回' }),
  field('studentsNumber', 'string | null', '已学习人数/总人数摘要', { nullable: true, nullMeaning: '后端未返回' }),
  field('children', 'object[]', '子节点；Portal列表叶子节点会省略children', { optional: true }),
]

const pageRowFields: AiField[] = rowFields.map(item => ({ ...item, path: `[].${item.path}` }))

const studentFields: AiField[] = [
  field('list', 'object[]', '当前页学习人员'),
  field('list[].realName', 'string | null', '人员姓名', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].mobile', 'string | null', '人员手机号', { nullable: true, nullMeaning: '后端未返回' }),
  field('list[].isRead', '0 | 1 | null', '是否学习；1=是、0=否', { nullable: true, nullMeaning: '后端未返回' }),
  field('total', 'number', '符合筛选条件的总人数，不是当前页长度'),
]

const pageOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: pageRowFields,
  empty: '[]表示当前筛选没有可见节点；权限、会话、网络或响应形状错误会抛出，不降级为空树。',
}
const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: rowFields,
  empty: '不存在、无权限或字段形状不符合Portal详情会抛错；SDK不把缺失详情降级为空对象。',
}
const trueOutput: AiContract['output'] = {
  shape: 'true',
  fields: [field('$', 'true', '后端CommonResult<Boolean>解包后的成功值true')],
  empty: '没有true或请求抛错不能报告保存、删除、共享或权限内容更新成功。',
}
const preparationOutput = (label: string): AiContract['output'] => ({
  shape: '{ draft: object, previous?: object }',
  fields: [field('draft', 'object', `${label}已按Portal表单规则校验、尚未写入的完整草稿`), field('previous', 'object', '编辑前快照；取消时只丢弃draft，不调用写接口', { optional: true })],
  empty: '名称、ID、制度类型、关联组织、文件数量或目录章节规则不符合Portal时在发请求前抛错。',
})
const shareOutput: AiContract['output'] = {
  shape: '{ organization: object[], post: object[], duty: object[], user: object[] }',
  fields: [
    field('organization', 'object[]', '共享组织成员；成员含id，响应可能含name/managerType'),
    field('post', 'object[]', '共享岗位成员；成员含id，响应可能含name/managerType'),
    field('duty', 'object[]', '共享职务成员；成员含id，响应可能含name/managerType'),
    field('user', 'object[]', '共享人员成员；成员含id，响应可能含name/managerType'),
    field('organization[].id', 'string | number', '组织成员ID'), field('post[].id', 'string | number', '岗位成员ID'),
    field('duty[].id', 'string | number', '职务成员ID'), field('user[].id', 'string | number', '人员成员ID'),
    field('organization[].managerType', 'number | null', 'Portal共享展示用管理类型；保存时不提交', { nullable: true, optional: true, nullMeaning: '响应未返回' }),
  ],
  empty: '没有共享成员时四个数组为空；权限、网络或响应形状错误仍抛出。',
}
const powerFields: AiField[] = [
  field('id', 'string | number', '固定无权限内容字典数据ID 1225814271879340854'),
  field('dictTypeId', 'string | number', '旧版HR字典类型ID'),
  field('dictLabel', 'string', 'Portal“无权限内容”文本框展示和保存的内容；最多200字符由页面控件限制'),
  field('dictValue', 'string | null', '字典值原值', { nullable: true, nullMeaning: '后端未返回' }),
  field('remark', 'string | null', '字典备注', { nullable: true, nullMeaning: '后端未返回' }),
  field('sort', 'number | null', '字典排序值', { nullable: true, nullMeaning: '后端未返回' }),
  field('createDate', 'string | null', '创建时间', { nullable: true, nullMeaning: '后端未返回' }),
  field('updateDate', 'string | null', '更新时间；保存时由SDK按Portal格式覆盖', { nullable: true, nullMeaning: '后端未返回' }),
]

const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js @ f61fdca1513956765ce3b927b8a9e961ef3742d3: app/portal/menus/hr.js、views/dashboard/hr/institution/company.vue、company/list.vue、company/[mode]/[id].vue、company/actions/upload-institution.vue、company/statics.vue、company/components/power-content.vue、components/portal/hxr/modal-share-user/index.vue', kind: 'reference', note: '逐页核对公司制度菜单/权限、目录树请求、文件夹与制度表单提交、文件类型/数量、目录章节映射、学习人员、无权限内容、下载和共享动作。' },
  { source: 'CodeReview_Mall_Platform_Java @ 7aeaca409d5999d8ba7723f47fd248a0ef56b170: HrPolicyController、HrPolicyServiceImpl、HrPolicySaveReqVO、HrUploadFilesSaveReqVO、HrPolicyRespVO、HrPolicyDirectorySaveReqVO、HrPolicyChapterSaveReqVO、HrPolicyCategoryController、HrShareUserController及相关VO', kind: 'reference', note: '核对制度树/详情/精简列表/CRUD/学习人员端点、重复名称与角色授权、目录章节、Long ID、制度共享type=1和旧版字典端点。' },
  { source: 'src/capabilities/company-policy.ts 与 test/company-policy.test.ts', kind: 'implementation', note: '锁定Portal请求形状、文件夹/制度分流、目录章节重编号、共享成员映射、下载响应和坏响应反证；不替代真实环境写入回查。' },
]

const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  ...value,
  whenToUse: '操作Portal「风控管理 → 制度管理 → 公司制度」目录、制度表单、学习人员、无权限内容或共享设置。',
  boundaries: [
    '页面路径是/dashboard/institution/company/list，权限是/dashboard/institution/company；使用platform HTTP实例和module-type=15（风险防控），调用方不要另拼页面上下文。',
    '目录树只暴露Portal当前列表的name筛选，并固定发送order=""、orderField=""；列表响应是树数组，不是{list,total}分页。叶子节点按Portal mapTree行为省略children。',
    '节点type固定为1（文件夹）或2（制度）。文件夹表单name必填且最多50字符，保存时name按Portal blur规则trim；pid为空时文件夹请求发送0，roleIds发送已选择的角色ID数组，type固定1。',
    '上传制度必须有制度类型category、关联组织organizationId和至少1个已上传文件，最多10个；文件只接受Portal的doc、docx、pdf MIME，提交只发送文件名和OSS URL，不能把本地文件路径当fileUrl。创建制度发送type=2及目录列表，后端重复名称会拒绝。',
    '编辑制度的请求只发送id、name、fileUrl、pid、type、category、organizationId和directoryList；编辑表单会按当前数组顺序重新生成“第X章/第X节”，每个已有目录/章节内容必填且最多50字符。',
    '删除文件夹由后端递归删除子节点；删除、创建和更新的true只表示接口回执，必须按steps重新列表或详情回查。下载/预览会把http文件URL提升为https并返回文件字节，不把页面跳转当作下载完成。',
    '共享type固定为1（制度）；读取响应中的name/managerType只用于展示，保存组织、岗位、职务和人员时每项只发送{id}。无权限内容是固定旧版字典ID 1225814271879340854，保存时覆盖updateDate为Portal的YYYY-MM-DD HH:mm:ss当前时间。',
    '列表、详情、写入、学习人员、字典和共享均受当前会话、租户、页面权限与后端数据范围约束；SDK不以空数组、true或HTTP成功单独代替业务证据。',
  ],
  prerequisites: ['使用当前用户会话、租户和页面权限创建SDK；角色、组织、制度类型和共享成员ID必须来自已核实的Portal候选，不猜ID；制度文件必须先通过Portal兼容的OSS上传能力取得URL。'],
  failures: ['字段必填/长度、ID、文件数量或MIME、目录章节、权限、租户、网络和响应形状错误会抛出；Portal/Java拒绝重复名称、空制度列表或无权操作时不能被包装成成功。'],
  evidence,
  gaps: ['已完成Portal/Java逐页静态核对与离线请求断言；尚未在真实测试环境执行公司制度文件夹/制度prepare→submit→cancel、删除、无权限内容、共享和下载回查。'],
})

const contracts: Record<string, AiContract> = {}
function add (id: string, value: AiContract): void {
  if (!definitions.has(id)) throw new Error(`Company policy contract has no definition: ${id}`)
  contracts[id] = value
}

const idInput = (meaning: string, source: string): Record<string, AiParameter> => ({ id: param(meaning, source, { type: 'string | number', required: true }) })
const draftInput = (meaning: string, source: string): AiParameter => param(meaning, source, { type: 'object', required: true })
const folderInput = param('文件夹名称、上级文件夹和角色授权；name会按Portal规则trim。', '用户明确填写的文件夹表单', { type: 'object', required: true, constraints: ['name必填且最多50字符', 'pid为空表示根目录', 'roleIds为已核实角色ID数组'] })
const documentInput = param('制度类型、关联组织、已上传制度文件和目录章节。', '用户明确填写的制度表单与OSS上传结果', { type: 'object', required: true, constraints: ['category和organizationId必填', 'files至少1项最多10项，每项含name和fileUrl', '已有目录/章节内容必填且最多50字符'] })

add('company-policy-list', base({
  purpose: '按名称查询当前用户可见的公司制度文件夹和制度树。', effect: 'read', inputs: { name: param('制度或文件夹名称筛选；省略时发送空字符串。', '用户明确输入', { type: 'string', required: false, nullable: true, omitted: '发送空字符串' }) }, output: pageOutput,
  consume: ['用节点id和type决定后续操作：type=1可创建下级目录/制度或编辑文件夹，type=2可编辑、下载、查看学习人员或配置共享。', '需要编辑时先用company-policy-get读取最新详情；不要凭列表摘要重建目录。'],
  steps: [{ role: 'optional', when: '需要编辑或核实写入', capabilityId: 'company-policy-get', mapping: { id: '[].id' }, instruction: '读取目标节点最新详情。' }],
  completion: '返回当前名称筛选下的制度目录树；查询不修改数据。', idempotency: null,
}))
add('company-policy-get', base({ purpose: '读取一个公司制度文件夹或制度的最新详情，用于编辑和回查。', effect: 'read', inputs: idInput('制度或文件夹ID。', 'company-policy-list[].id'), output: detailOutput, consume: ['type=1使用文件夹prepare/update链路；type=2使用制度prepare/update链路。directoryList中的章节内容是编辑制度的表单来源。'], steps: [], completion: '得到目标节点最新详情快照。', idempotency: null }))
add('company-policy-parent-list', base({ purpose: '读取Portal制度表单使用的上级文件夹候选树。', effect: 'read', inputs: {}, output: pageOutput, consume: ['只把type=1节点作为pid候选；不要把制度节点当作上级文件夹。'], steps: [], completion: '得到可选择的文件夹树。', idempotency: null }))
add('company-policy-category-list', base({ purpose: '读取上传制度表单使用的制度类型候选。', effect: 'read', inputs: {}, output: { shape: 'object[]', fields: [field('[].id', 'string | number', '制度类型ID'), field('[].name', 'string | null', '制度类型名称', { nullable: true }), field('[].sort', 'number | null', '排序', { nullable: true }), field('[].size', 'number | null', '关联制度数量', { nullable: true })], empty: '[]表示当前会话没有可选制度类型。' }, consume: ['将候选id原样填入制度表单category，不要自行创建或改写字典值。'], steps: [], completion: '得到可选择的制度类型。', idempotency: null }))
add('company-policy-prepare-create-folder', base({ purpose: '按Portal文件夹表单规则准备一个尚未写入的文件夹草稿。', effect: 'prepare', inputs: { form: folderInput }, output: preparationOutput('公司制度文件夹'), consume: ['取消时只丢弃draft；确认时把draft原样交给company-policy-create-folder。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'company-policy-create-folder', mapping: { draft: 'result.draft' }, instruction: '提交同一draft，收到ID后重新查询列表并读取详情。' }, { role: 'cancel', when: '用户取消', instruction: '丢弃draft，不调用写接口。' }], completion: '得到已校验、尚未写入的文件夹草稿。', idempotency: null }))
add('company-policy-create-folder', base({ purpose: '保存一个已准备的公司制度文件夹。', effect: 'write', inputs: { draft: draftInput('prepareCreateFolder返回的文件夹草稿。', 'company-policy-prepare-create-folder.draft') }, output: { shape: 'string | number', fields: [field('$', 'string | number', '后端新建文件夹ID')], empty: '没有ID或请求抛错不能报告创建完成。' }, consume: ['SDK复刻Portal的POST /admin-api/system/policy/create-file、pid空值转0、type=1和multipart头。'], steps: [{ role: 'required', when: '响应成功或超时', capabilityId: 'company-policy-get', mapping: { id: 'result.$' }, instruction: '按返回ID读取详情，并重新查询树确认父子关系和角色授权；超时先回查，不要盲目重建。' }, { role: 'cancel', when: '用户取消', instruction: '不调用createFolder。' }], completion: '列表和详情回查确认文件夹存在且字段生效后报告创建完成。', idempotency: '后端无requestId；超时先按返回ID回查。' }))
add('company-policy-prepare-update-folder', base({ purpose: '基于最新文件夹详情和用户修改准备完整编辑草稿。', effect: 'prepare', inputs: { current: param('company-policy-get返回的type=1详情。', 'company-policy-get', { type: 'object', required: true }), changes: param('用户明确修改的name、pid或roleIds。', '用户编辑意图', { type: 'object', required: false, nullable: true }) }, output: preparationOutput('公司制度文件夹'), consume: ['prepare不会发请求；取消时不调用updateFolder。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'company-policy-update-folder', mapping: { draft: 'result.draft' }, instruction: '提交完整draft后重新get和list回查。' }, { role: 'cancel', when: '用户取消', instruction: '只丢弃draft。' }], completion: '得到尚未写入的文件夹编辑草稿。', idempotency: null }))
add('company-policy-update-folder', base({ purpose: '保存已准备的公司制度文件夹编辑草稿。', effect: 'write', inputs: { draft: draftInput('prepareUpdateFolder返回的含id草稿。', 'company-policy-prepare-update-folder.draft') }, output: trueOutput, consume: ['请求是Portal的PUT /admin-api/system/policy/update，type固定1；true或超时后必须按draft.id回查。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'company-policy-get', mapping: { id: 'args.draft' }, instruction: '从draft.id读取同一文件夹详情并按列表核对父节点和角色授权。' }, { role: 'cancel', when: '用户取消', instruction: '不调用updateFolder。' }], completion: '详情和列表回查确认文件夹编辑生效后报告完成。', idempotency: '无requestId；PUT覆盖式更新，超时先回查。' }))
add('company-policy-prepare-create', base({ purpose: '按Portal上传制度表单规则准备尚未写入的制度草稿。', effect: 'prepare', inputs: { form: documentInput }, output: preparationOutput('公司制度'), consume: ['文件必须先通过OSS上传并得到fileUrl；目录数组只记录用户填写的目录/章节内容，prepare会按顺序生成第X章和第X节。', '取消时只丢弃draft。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'company-policy-create', mapping: { draft: 'result.draft' }, instruction: '提交同一draft；接口只返回true，随后按唯一文件名/父目录刷新列表回查。' }, { role: 'cancel', when: '用户取消', instruction: '不调用create。' }], completion: '得到已校验、尚未写入的制度草稿。', idempotency: null }))
add('company-policy-create', base({ purpose: '保存已准备的公司制度上传草稿。', effect: 'write', inputs: { draft: draftInput('prepareCreate返回的含文件和目录的草稿。', 'company-policy-prepare-create.draft') }, output: trueOutput, consume: ['SDK复刻Portal POST /admin-api/system/policy/create：pid、category、organizationId和list；list每项固定type=2并复用目录列表。'], steps: [{ role: 'required', when: '成功或超时', capabilityId: 'company-policy-list', instruction: '按原父目录和文件名刷新列表，必要时再get逐字段核对；没有返回ID时不得凭true报告唯一记录已落库。' }, { role: 'cancel', when: '用户取消', instruction: '不调用create。' }], completion: '列表回查确认预期文件名、父目录、制度类型、组织和文件URL均已生效后报告完成。', idempotency: '后端无requestId；创建超时先按父目录+文件名回查，不能盲目重复上传。' }))
add('company-policy-prepare-update', base({ purpose: '基于最新制度详情和用户修改准备完整编辑草稿。', effect: 'prepare', inputs: { current: param('company-policy-get返回的type=2详情。', 'company-policy-get', { type: 'object', required: true }), changes: param('用户明确修改的制度名称、父目录、制度类型、关联组织或目录章节。', '用户编辑意图', { type: 'object', required: false, nullable: true }) }, output: preparationOutput('公司制度'), consume: ['编辑会按Portal的computedDirectoryList重编号并只发送pick出的七个字段加directoryList；fileUrl沿用详情原值。'], steps: [{ role: 'required', when: '用户确认保存', capabilityId: 'company-policy-update', mapping: { draft: 'result.draft' }, instruction: '提交完整draft后按draft.id读取详情回查。' }, { role: 'cancel', when: '用户取消', instruction: '只丢弃draft。' }], completion: '得到尚未写入的制度编辑草稿。', idempotency: null }))
add('company-policy-update', base({ purpose: '保存已准备的公司制度编辑草稿。', effect: 'write', inputs: { draft: draftInput('prepareUpdate返回的含id制度草稿。', 'company-policy-prepare-update.draft') }, output: trueOutput, consume: ['请求是Portal的PUT /admin-api/system/policy/update；目录章节名称按数组位置重建，成功或超时后按id回查。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'company-policy-get', mapping: { id: 'args.draft' }, instruction: '从draft.id读取同一制度详情逐字段核对名称、父目录、制度类型、组织、文件URL和目录章节。' }, { role: 'cancel', when: '用户取消', instruction: '不调用update。' }], completion: '详情回查确认制度编辑生效后报告完成。', idempotency: '无requestId；PUT覆盖式更新，超时先回查。' }))
add('company-policy-remove', base({ purpose: '删除一个公司制度节点。', effect: 'write', inputs: idInput('制度或文件夹ID；文件夹删除会递归删除子节点。', 'company-policy-list[].id'), output: trueOutput, consume: ['删除成功或超时后重新查询树确认目标及其子节点不再出现；不要只凭true报告删除完成。'], steps: [{ role: 'required', when: '成功或超时', capabilityId: 'company-policy-list', instruction: '按原筛选刷新并确认目标ID已消失。' }, { role: 'cancel', when: '用户取消删除', instruction: '不调用remove。' }], completion: '列表回查确认目标节点已消失后报告删除完成。', idempotency: '无requestId；超时先回查，不重复删除已消失节点。' }))
add('company-policy-download', base({ purpose: '读取列表制度文件的二进制内容，用于Portal的预览或下载动作。', effect: 'read', inputs: { fileUrl: param('列表制度节点的fileUrl；必须是http或https URL。', 'company-policy-list[].fileUrl', { type: 'string', required: true }), fileName: param('Portal下载文件名，通常使用list[].name；省略时从URL路径提取。', 'company-policy-list[].name', { type: 'string', required: false }) }, output: { shape: '{ fileName: string, contentType: string | null, base64: string, byteLength: number }', fields: [field('fileName', 'string', '下载或预览文件名'), field('contentType', 'string | null', '响应Content-Type', { nullable: true, nullMeaning: '响应未返回' }), field('base64', 'string', '文件字节的Base64编码'), field('byteLength', 'number', '文件字节数；必须大于0')], empty: '空文件、非法URL或网络错误会抛出。' }, consume: ['Portal会把http URL替换为https；SDK返回文件字节，调用方自行决定保存、预览或交给文件处理器。'], steps: [], completion: '得到非空的制度文件内容。', idempotency: null }))
add('company-policy-student-list', base({ purpose: '按人员姓名、手机号和是否学习查询某制度的学习人员分页。', effect: 'read', inputs: { policyId: param('制度ID。', 'company-policy-list[].id', { type: 'string | number', required: true }), name: param('姓名筛选；默认空字符串。', '用户明确输入', { type: 'string', required: false }), mobile: param('手机号筛选；默认空字符串。', '用户明确输入', { type: 'string', required: false }), isRead: param('是否学习；0=否、1=是，Portal默认0。', 'Portal单选候选', { type: 'number', required: false, default: '0' }), pageNo: param('页码；默认1。', '分页状态', { type: 'number', required: false, default: '1' }), pageSize: param('每页条数；默认20。', '分页状态', { type: 'number', required: false, default: '20' }) }, output: { shape: '{ list: object[], total: number }', fields: studentFields, empty: 'list=[]表示当前页无人员；权限、会话、网络或响应形状错误会抛出。' }, consume: ['total是总人数，不是当前页长度；按Portal的0/1候选解释isRead。'], steps: [], completion: '返回当前制度学习人员的一页结果。', idempotency: null }))
add('company-policy-get-power-content', base({ purpose: '读取公司制度页面“无权限内容”弹窗的固定字典内容。', effect: 'read', inputs: {}, output: { shape: 'object', fields: powerFields, empty: '固定字典记录不存在、无权或响应形状错误会抛出。' }, consume: ['只把dictLabel作为页面文本内容展示；id、dictTypeId和其他字段在保存时必须保留。'], steps: [], completion: '得到当前无权限内容字典快照。', idempotency: null }))
add('company-policy-update-power-content', base({ purpose: '保存公司制度页面的无权限内容文本。', effect: 'write', inputs: { draft: param('company-policy-get-power-content返回的完整字典对象；只修改dictLabel等用户明确字段。', 'company-policy-get-power-content', { type: 'object', required: true, constraints: ['dictLabel必填且页面最多200字符'] }) }, output: trueOutput, consume: ['SDK保留字典对象字段，并按Portal格式用当前时间覆盖updateDate；成功或超时后必须重新getPowerContent回查。'], steps: [{ role: 'required', when: '成功或超时', capabilityId: 'company-policy-get-power-content', instruction: '重新读取固定字典ID核对dictLabel和updateDate。' }, { role: 'cancel', when: '用户取消', instruction: '不调用updatePowerContent。' }], completion: '回查确认无权限内容文本已生效后报告完成。', idempotency: '无requestId；超时先回查固定字典ID。' }))
add('company-policy-get-share', base({ purpose: '读取一个制度的组织、岗位、职务和人员共享设置。', effect: 'read', inputs: { resourceId: param('制度ID。', 'company-policy-list[].id', { type: 'string | number', required: true }) }, output: shareOutput, consume: ['共享type固定为1；managerType是展示字段，不当作保存参数。'], steps: [], completion: '得到制度共享设置快照。', idempotency: null }))
add('company-policy-save-share', base({ purpose: '保存一个制度的组织、岗位、职务和人员共享设置。', effect: 'write', inputs: { resourceId: param('制度ID。', 'company-policy-list[].id', { type: 'string | number', required: true }), organization: param('共享组织成员数组；保存时每项只取id。', 'company-policy-get-share.organization或已核实候选', { type: 'object[]', required: false }), post: param('共享岗位成员数组；保存时每项只取id。', 'company-policy-get-share.post或已核实候选', { type: 'object[]', required: false }), duty: param('共享职务成员数组；保存时每项只取id。', 'company-policy-get-share.duty或已核实候选', { type: 'object[]', required: false }), user: param('共享人员成员数组；保存时每项只取id。', 'company-policy-get-share.user或已核实候选', { type: 'object[]', required: false }) }, output: trueOutput, consume: ['请求type固定为1；保存后必须重新getShare逐类核对成员，不能把managerType或name发回。'], steps: [{ role: 'required', when: '成功或超时', capabilityId: 'company-policy-get-share', mapping: { resourceId: 'args.resourceId' }, instruction: '回查四类共享成员；未确认前不要重复覆盖保存。' }, { role: 'cancel', when: '用户取消共享设置', instruction: '不调用saveShare。' }], completion: 'getShare回查确认四类共享成员生效后报告完成。', idempotency: '无requestId；共享保存是覆盖式配置，超时先回查。' }))

export const COMPANY_POLICY_AI_CONTRACTS = contracts
export const COMPANY_POLICY_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(COMPANY_POLICY_METHODS).map(([id, method]) => [`companyPolicy.${method}`, { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, '直接SDK方法按inputs接收对象参数；prepare只产生草稿，不能被误报为已写入。'] }]),
)
