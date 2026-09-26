import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { HR_POST_SETTING_METHODS, hrPostSettingCapabilities } from '../capabilities/hr-post-setting.js'

const definitions = new Map(hrPostSettingCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const rowFields: AiField[] = [
  field('id', 'string | number', '岗位或目录主键；Java Long可能序列化为字符串，必须原样保留', { constraints: ['正整数'] }),
  field('name', 'string | null', '岗位或目录名称；表格名称列', { nullable: true, nullMeaning: '后端未返回名称' }),
  field('dataType', 'integer | null', '行类型：1=文件夹、2=岗位', { nullable: true, values: { '1': '文件夹', '2': '岗位' }, nullMeaning: '后端未返回类型' }),
  field('parent', 'string | number | null', '直接父目录ID；根目录通常为0或null，取决于后端序列化', { nullable: true, nullMeaning: '根目录或未返回' }),
  field('postTypeName', 'string | null', '岗位类别名称展示串；目录通常为空', { nullable: true, nullMeaning: '未配置或该行是目录' }),
  field('salaryLevelMin', 'string | number | null', '岗位薪资等级范围下限ID；目录或未设置时为空', { nullable: true, nullMeaning: '未设置/不适用' }),
  field('salaryLevelMax', 'string | number | null', '岗位薪资等级范围上限ID；目录或未设置时为空', { nullable: true, nullMeaning: '未设置/不适用' }),
  field('ancestorPath', 'object[]', '跨层搜索时返回的祖先目录链；按从上到下排列，普通当前目录查询通常为空'),
  field('ancestorPath[].id', 'string | number', '祖先目录ID'),
  field('ancestorPath[].name', 'string | null', '祖先目录名称', { nullable: true, nullMeaning: '后端未返回名称' }),
  field('ancestorPath[].available', 'boolean | null', '祖先是否仍可见；false表示路径节点缺失或不可用', { nullable: true, nullMeaning: '后端未返回可用标记' }),
]

const detailFields: AiField[] = [
  field('id', 'string | number', '岗位或目录主键；编辑时必须原样保留', { constraints: ['正整数'] }),
  field('roleIdList', 'array', '页面表单初始为空的角色ID列表；Portal保存时会随表单发送'),
  field('parent', 'string | number | null', '上级目录ID；详情返回字符串"0"时SDK按Portal表单规则归一为null', { nullable: true, nullMeaning: '根目录' }),
  field('name', 'string', '岗位名称或目录名称；必填，不能全为空格，最多50个字符'),
  field('postType', 'string', '岗位类别ID逗号分隔字符串；get已把后端数组join为页面表单值，空数组/未返回为空字符串'),
  field('dataType', 'integer', '表单类型：1=文件夹、2=岗位'),
  field('gender', 'integer', '性别要求：0=男、1=女、2=无要求'),
  field('salaryLevelMin', 'string | number | null', '薪资等级范围下限ID', { nullable: true, nullMeaning: '未选择' }),
  field('salaryLevelMax', 'string | number | null', '薪资等级范围上限ID', { nullable: true, nullMeaning: '未选择' }),
  field('postAssignment', 'string | null', '岗位定责；可空，最多500个字符且不能全为空格', { nullable: true, nullMeaning: '未填写' }),
  field('educationalRequirement', 'string | null', '学历要求；可空，最多500个字符且不能全为空格', { nullable: true, nullMeaning: '未填写' }),
  field('experienceRequirement', 'string | null', '经历要求；可空，最多500个字符且不能全为空格', { nullable: true, nullMeaning: '未填写' }),
  field('abilityRequirement', 'string | null', '能力要求；可空，最多500个字符且不能全为空格', { nullable: true, nullMeaning: '未填写' }),
  field('remark', 'string | null', '备注；可空，最多200个字符且不能全为空格', { nullable: true, nullMeaning: '未填写' }),
  field('postTypeName', 'string | null', '岗位类别展示名称；详情页只读展示', { nullable: true, nullMeaning: '后端未返回' }),
  field('postTypeNameList', 'string[] | null', '岗位类别名称数组；详情页由后端返回的附加展示字段', { nullable: true, nullMeaning: '没有岗位类别' }),
]

const salaryLevelOutput: AiContract['output'] = {
  shape: 'object[]',
  fields: [
    field('[]', 'object', '按页面sort规则排序的薪资等级记录'),
    field('[].id', 'string | number', '薪资等级ID，用于salaryLevelMin/salaryLevelMax'),
    field('[].name', 'string | null', '薪资等级名称；列表/详情展示用', { nullable: true, nullMeaning: '后端未返回名称' }),
    field('[].sort', 'integer | null', '页面范围校验使用的排序值；无排序值的记录排在末尾', { nullable: true, nullMeaning: '无排序值' }),
  ],
  empty: '[]表示没有可用薪资等级；页面在该情况下不会执行上下限顺序校验。',
}

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('list', 'object[]', '当前目录层或跨层搜索的岗位/目录记录；SDK已按Portal删除每行children'),
    field('total', 'number', '符合当前树查询条件的总记录数，不是当前页长度'),
    ...rowFields.map(item => ({ ...item, path: `list[].${item.path}` })),
  ],
  empty: 'list=[]且total=0表示当前父目录或关键字没有匹配项；响应形状、权限和网络错误会抛出。',
}

const detailOutput: AiContract['output'] = {
  shape: 'object',
  fields: detailFields,
  empty: '岗位或目录不存在、详情缺少有效ID或postType响应形状错误会抛出；不要把空对象当作可编辑表单。',
}

const draftFields: AiField[] = [
  field('draft', 'object', '尚未提交的岗位设置POST /org/hrpost/save请求体'),
  field('draft.roleIdList', 'array', 'Portal默认的角色ID列表；通常为空数组'),
  field('draft.parent', 'string | number | null', '上级目录ID；根目录为null（调用方传入数字0时按页面原值保留）', { nullable: true, nullMeaning: '根目录' }),
  field('draft.name', 'string', '岗位或目录名称；必填、非全空格、最多50字符'),
  field('draft.postType', 'string[]', '由页面逗号分隔字符串split得到的岗位类别ID数组；空字符串会按Portal得到[""]，不要擅自改成[]'),
  field('draft.dataType', 'integer', '1=文件夹、2=岗位'),
  field('draft.gender', 'integer', '0=男、1=女、2=无要求'),
  field('draft.salaryLevelMin', 'string | number | null', '薪资等级范围下限ID', { nullable: true, nullMeaning: '未选择' }),
  field('draft.salaryLevelMax', 'string | number | null', '薪资等级范围上限ID', { nullable: true, nullMeaning: '未选择' }),
  field('draft.postAssignment', 'string | null', '岗位定责；可空，最多500字符', { nullable: true, nullMeaning: '未填写' }),
  field('draft.educationalRequirement', 'string | null', '学历要求；可空，最多500字符', { nullable: true, nullMeaning: '未填写' }),
  field('draft.experienceRequirement', 'string | null', '经历要求；可空，最多500字符', { nullable: true, nullMeaning: '未填写' }),
  field('draft.abilityRequirement', 'string | null', '能力要求；可空，最多500字符', { nullable: true, nullMeaning: '未填写' }),
  field('draft.remark', 'string | null', '备注；可空，最多200字符', { nullable: true, nullMeaning: '未填写' }),
]

const updateDraftFields = [...draftFields, field('draft.id', 'string | number', '编辑目标ID；来自get，必须原样保留', { constraints: ['正整数'] })]
const voidOutput: AiContract['output'] = { shape: 'undefined', fields: [], empty: '成功没有业务返回值；必须按ID/名称回查确认写入，HTTP或业务错误会抛出。' }
const previewOutput: AiContract['output'] = {
  shape: '{ fileName: string, contentType: string, byteLength: number }',
  fields: [field('fileName', 'string', '待上传文件名'), field('contentType', 'string', 'Portal认可的xlsx MIME'), field('byteLength', 'number', '文件字节数')],
  empty: '空文件、非法Base64或Portal不接受的MIME会抛出；预览不代表已上传。',
}
const fileOutput: AiContract['output'] = {
  shape: '{ fileName: string, contentType: string, byteLength: number, base64: string }',
  fields: [field('fileName', 'string', '服务端Content-Disposition文件名，缺失时使用页面默认名'), field('contentType', 'string', '响应Content-Type或Excel默认MIME'), field('byteLength', 'number', '文件字节数'), field('base64', 'string', '文件二进制标准Base64；调用方负责保存')],
  empty: '空文件响应会抛出。',
}
const deletePreparationOutput: AiContract['output'] = {
  shape: '{ ids: object[], verificationRequired: boolean, phone: string | null }',
  fields: [field('ids', 'array', '通过页面删除前置检查的去重ID数组'), field('verificationRequired', 'boolean', '敏感删除开启时必须先发送并校验短信'), field('phone', 'string | null', '敏感配置接收手机号；只用于发送验证码', { nullable: true, nullMeaning: '无需验证或未配置' })],
  empty: '子节点、组织占用或其它后端删除保护失败时请求抛错；不要把失败当作可删除。',
}
const smsOutput: AiContract['output'] = {
  shape: '{ smsRequestId: string }',
  fields: [field('smsRequestId', 'string', '短信校验requestId；不是删除幂等键')],
  empty: '响应缺少requestId会抛错且不会自动重发短信。',
}

const readGaps = ['已逐页核对Portal列表/表单/导入导出组件、Java Controller/DTO/Service、SDK实现和离线请求断言；尚未在真实测试环境执行浏览器读请求。']
const writeGaps = [...readGaps, '尚未在真实测试环境执行新建、编辑、删除敏感验证、导入和导出；页面没有撤销接口，取消只代表丢弃本地草稿或不继续提交。']

function typeOf (kind: string): string {
  if (kind === 'number') return 'number'
  if (kind === 'boolean') return 'boolean'
  return 'string'
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`岗位设置契约缺少能力定义：${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, param(parameter.description ?? parameter.name, '用户提供的Portal岗位设置输入或前一步能力结果', { type: typeOf(parameter.kind), required: parameter.required })]))
}

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/hr.js、app/portal/views/dashboard/hr/post/post-setting/list.vue、[mode]/[id].vue及三个components', kind: 'reference', note: '逐页核对菜单权限、module-type、树分页参数、表单字段和校验、敏感删除、导入、模板下载、自定义导出及页面实际动作边界。' },
  { source: 'HrPostController、HrPostDTO、HrPostListDTO、HrSalaryLevelController、HrPostServiceImpl、HrBoundedTreeQueryDTO', kind: 'reference', note: '核对树查询边界、同一save接口的新建/编辑、删除前置条件、Excel端点、薪资等级及后端字段。' },
  { source: 'src/capabilities/hr-post-setting.ts 与 test/hr-post-setting.test.ts', kind: 'implementation', note: '核对SDK请求参数顺序、请求体投影、文件协议、敏感保护和反证测试；不替代真实环境写回查。' },
  { source: 'docs/pages/岗位设置.md', kind: 'reference', note: '记录页面四件套、Portal/Java对齐证据和真实环境缺口。' },
]

const base = (id: string, purpose: string, effect: AiContract['effect'], output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract => ({
  purpose,
  whenToUse: purpose,
  boundaries: [
    '页面路径是/dashboard/post/post-setting/list，权限码是/dashboard/post/post-setting，所有请求走platform实例并按页面带module-type=11；调用方不要自行拼接权限头。',
    '列表是按父目录分页：keyword trim后为空走treePage，非空走searchPage并固定dataType=2；两条请求都固定selection=false，不能改成选择器范围。pageSize按Portal压到100以内。',
    '列表行的children由Portal在交给表格前主动删除；跨层搜索用ancestorPath解释路径，不要把缺少children当成没有下级。',
    '新建和编辑页面使用同一个 POST /org/hrpost/save；是否更新由请求体是否带id决定，不要改成Java Controller虽存在但页面未调用的PUT /org/hrpost。',
    '页面表单把postType逗号字符串split为数组，省略、空字符串和null的差异必须按草稿说明处理；三个salaryLevel名称字段是UI展示字段，提交时删除。',
    '删除必须先经过checkCanDelete；敏感配置开启时还要发送并校验短信验证码。Portal当前页面没有nodeDetails、旧/import、getOrgPostList等其它Controller接口入口，SDK不把它们冒充本页能力。',
  ],
  effect,
  prerequisites: ['使用当前会话token、当前租户和岗位设置页面权限；ID、父目录和岗位类别必须来自当前租户可见数据或用户明确提供。'],
  inputs: inputsOf(id),
  output,
  consume,
  steps: [],
  completion: effect === 'write' ? '请求未抛错后仍必须按页面对象/ID回查；prepare或导入预览成功不代表服务端已写入。' : '返回值符合当前Portal页面接口语义；权限、网络或响应形状错误必须抛出。',
  failures: ['名称、文本长度、全空格、类型、ID、分页、文件Base64或MIME不符合Portal规则时SDK在发请求前拒绝；删除占用、名称重复、后端权限、Excel内容和数据范围由后端继续判断。', '写请求超时或返回空回执时先回查，不盲目重复创建、保存、删除或导入。'],
  idempotency: effect === 'write' ? '后端没有requestId；保存、删除和两种导入超时都必须先按ID/名称/文件效果回查再决定是否重试；短信发送结果不确定时不自动重发。' : null,
  evidence,
  gaps: effect === 'write' ? writeGaps : readGaps,
  ...extra,
})

const contracts: Record<string, AiContract> = {}
function add (id: string, contract: AiContract): void {
  if (!definitions.has(id)) throw new Error(`岗位设置契约没有对应能力定义：${id}`)
  contracts[id] = contract
}

add('hr-post-setting-list', base('hr-post-setting-list', '按当前目录或名称关键字读取岗位设置分页。', 'read', listOutput, ['利用dataType=1行的id继续读取下级目录；利用dataType=2行的id进入get、编辑、导出或删除。']))
add('hr-post-setting-get', base('hr-post-setting-get', '读取岗位或目录的完整Portal表单状态。', 'read', detailOutput, ['把完整结果作为prepareUpdate.current；不要只凭列表行构造全量save请求。']))
add('hr-post-setting-salary-levels', base('hr-post-setting-salary-levels', '读取并按Portal sort规则排序岗位设置薪资等级选项。', 'read', salaryLevelOutput, ['把返回数组同时传给prepareCreate/prepareUpdate的salaryLevels，才能复刻页面上下限顺序校验；页面获取失败时选项为空且不执行该校验。']))
add('hr-post-setting-prepare-create', base('hr-post-setting-prepare-create', '按Portal新建表单默认值、字段规则和薪资范围规则生成岗位设置创建草稿，不发写请求。', 'prepare', { shape: '{ draft: object }', fields: draftFields, empty: '必填名称、文本长度、全空格、类型、ID或提供的薪资顺序校验不通过时不生成草稿。' }, ['确认类型、名称、上级目录和岗位字段后，把同一result.draft交给create；用户取消时丢弃draft。'], { steps: [{ role: 'required', when: '用户确认新建', capabilityId: 'hr-post-setting-create', mapping: { draft: 'result.draft' }, instruction: '提交同一个draft；成功或超时后按名称和父目录list回查，再用get核对字段。' }, { role: 'cancel', when: '用户取消新建', instruction: '只丢弃draft，不调用create。' }] }))
add('hr-post-setting-create', base('hr-post-setting-create', '提交一个通过Portal新建表单规则的岗位或目录草稿。', 'write', voidOutput, ['请求体是POST /org/hrpost/save且不带id；成功或超时后按名称、dataType和parent回查，不能只看空回执。'], { steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'hr-post-setting-list', instruction: '按创建时的父目录、名称和类型回查，再用get逐字段核对新记录。' }] }))
add('hr-post-setting-prepare-update', base('hr-post-setting-prepare-update', '基于最新get详情和用户明确变更生成Portal全量岗位设置保存草稿。', 'prepare', { shape: '{ draft: object }', fields: updateDraftFields, empty: 'current缺少有效id、名称或字段规则不通过时不生成草稿。' }, ['current中的非UI字段原样保留；changes只覆盖页面表单字段；用户取消时丢弃draft。'], { steps: [{ role: 'required', when: '用户确认编辑', capabilityId: 'hr-post-setting-update', mapping: { draft: 'result.draft' }, instruction: '提交同一个draft；成功或超时后按draft.id调用get逐字段回查。' }, { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不调用update。' }] }))
add('hr-post-setting-update', base('hr-post-setting-update', '提交一个通过Portal编辑规则的岗位或目录全量保存草稿。', 'write', voidOutput, ['请求体仍是POST /org/hrpost/save且保留id；服务端按id进入更新分支。成功或超时后必须get回查。'], { steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'hr-post-setting-get', mapping: { id: 'args.draft.id' }, instruction: '按同一id读取最新详情，核对name、parent、dataType、gender、postType、薪资范围和文本字段。' }] }))
add('hr-post-setting-prepare-remove', base('hr-post-setting-prepare-remove', '执行Portal删除前置检查并读取敏感操作配置。', 'prepare', deletePreparationOutput, ['后端拒绝含子节点、已被组织使用或其它占用的ID时直接抛错；verificationRequired=true时先sendDeleteCode；用户取消时不继续。'], { steps: [{ role: 'required', when: '用户确认删除且需要短信', capabilityId: 'hr-post-setting-send-delete-code', mapping: { ids: 'result.ids' }, instruction: '把同一ID数组交给sendDeleteCode。' }, { role: 'optional', when: '用户确认删除且无需短信', capabilityId: 'hr-post-setting-remove', mapping: { ids: 'result.ids' }, instruction: '直接执行remove，完成后回查列表。' }, { role: 'cancel', when: '用户取消删除', instruction: '不调用验证码或remove。' }] }))
add('hr-post-setting-send-delete-code', base('hr-post-setting-send-delete-code', '在敏感删除开启时向配置手机号发送验证码。', 'write', smsOutput, ['模板ID固定为17709；只把requestId交给remove，验证码必须由手机号持有人提供。'], { steps: [{ role: 'required', when: '收到用户验证码并确认删除', capabilityId: 'hr-post-setting-remove', mapping: { ids: 'args.ids', smsRequestId: 'result.smsRequestId', code: 'user.code' }, instruction: '将用户输入的验证码交给remove；不要猜测、保存或自动重发。' }] }))
add('hr-post-setting-remove', base('hr-post-setting-remove', '按Portal删除前置、敏感验证和裸ID数组DELETE规则删除岗位或目录。', 'write', voidOutput, ['SDK会重新执行删除前置检查；敏感保护开启时先校验短信，再发送DELETE /org/hrpost的裸ID数组。成功或超时后按ID回查列表。'], { steps: [{ role: 'required', when: 'DELETE完成或超时', capabilityId: 'hr-post-setting-list', instruction: '在同一父目录或关键字范围回查目标ID；未确认消失前不要重复删除。' }] }))
add('hr-post-setting-download-template', base('hr-post-setting-download-template', '下载Portal岗位信息模板Excel。', 'read', fileOutput, ['保存返回的base64文件；页面实际向/org/hrpost/download发送fileName=岗位信息模板。']))
add('hr-post-setting-export', base('hr-post-setting-export', '导出Portal自定义导出选择的岗位或目录及其岗位信息Excel。', 'read', fileOutput, ['id来自页面岗位树选择；保存返回的base64文件，不能把导出回执当成写入证据。']))
add('hr-post-setting-prepare-import', base('hr-post-setting-prepare-import', '校验Portal新增岗位导入控件接受的xlsx文件并生成预览。', 'prepare', previewOutput, ['保存原始file和parentId；用户确认后把同一文件交给import；用户取消不上传。'], { steps: [{ role: 'required', when: '用户确认新增导入', capabilityId: 'hr-post-setting-import', mapping: { file: 'args.file', parentId: 'args.parentId' }, instruction: '保持父目录映射；成功或超时后按文件中的岗位名称回查列表。' }, { role: 'cancel', when: '用户取消导入', instruction: '不调用import。' }] }))
add('hr-post-setting-import', base('hr-post-setting-import', '提交Portal新增岗位xlsx导入。', 'write', voidOutput, ['发送multipart字段file；根目录parentId按页面发送null；成功或超时后按文件中的岗位名称和父目录回查。'], { steps: [{ role: 'required', when: '上传完成或超时', capabilityId: 'hr-post-setting-list', instruction: '回查目标父目录或关键字，逐条核对导入的岗位名称、类型和薪资等级。' }] }))
add('hr-post-setting-prepare-import-update', base('hr-post-setting-prepare-import-update', '校验Portal导入更新控件接受的xlsx文件并生成预览。', 'prepare', previewOutput, ['用户确认后把同一文件交给importUpdate；用户取消不上传。'], { steps: [{ role: 'required', when: '用户确认更新导入', capabilityId: 'hr-post-setting-import-update', mapping: { file: 'args.file' }, instruction: '成功或超时后按文件中的岗位标识回查get/list。' }, { role: 'cancel', when: '用户取消导入更新', instruction: '不调用importUpdate。' }] }))
add('hr-post-setting-import-update', base('hr-post-setting-import-update', '提交Portal岗位信息xlsx导入更新。', 'write', voidOutput, ['发送multipart字段file；后端会逐行处理更新；成功或超时后按文件中的岗位标识回查。'], { steps: [{ role: 'required', when: '上传完成或超时', capabilityId: 'hr-post-setting-list', instruction: '回查列表并用get逐字段核对被更新岗位。' }] }))

for (const [id, contract] of Object.entries(contracts)) {
  const definition = definitions.get(id)
  if (!definition) continue
  for (const parameter of definition.params) {
    if (parameter.name === 'form' || parameter.name === 'current' || parameter.name === 'changes' || parameter.name === 'draft' || parameter.name === 'salaryLevels' || parameter.name === 'file') {
      contract.inputs[parameter.name] = param(contract.inputs[parameter.name]?.meaning ?? parameter.description ?? parameter.name, '用户填写的Portal表单、文件或前一步能力结果', {
        type: parameter.name === 'file' || parameter.name === 'form' || parameter.name === 'current' || parameter.name === 'changes' || parameter.name === 'draft' || parameter.name === 'salaryLevels' ? 'object' : contract.inputs[parameter.name]?.type,
        required: parameter.required,
      })
    }
  }
}

contracts['hr-post-setting-update']!.inputs['draft.id'] = param(
  '编辑草稿中的岗位或目录ID；从prepareUpdate结果原样取出，用于保存后回查。',
  'hr-post-setting-prepare-update.draft.id',
  { type: 'string | number', required: true },
)

export const HR_POST_SETTING_AI_CONTRACTS = contracts
export const HR_POST_SETTING_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(HR_POST_SETTING_METHODS).map(([id, method]) => [
    `hrPostSetting.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, '直接方法路径为 hrPostSetting.' + method + '；写入动作遵守对应prepare→submit，取消仅丢弃未提交输入。'] },
  ]),
)
