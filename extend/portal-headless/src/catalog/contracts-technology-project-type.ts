import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  TECHNOLOGY_PROJECT_DOMAINS,
  TECHNOLOGY_PROJECT_TYPE_METHODS,
  TECHNOLOGY_PROJECT_TYPE_ROLES,
} from '../capabilities/technology-project-type.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const domains = [
  { value: 'biology', label: '生物' },
  { value: 'information', label: '信息' },
  { value: 'engineering', label: '工程' },
]
const roles = [
  { value: 'project_owner', label: '项目负责人' },
  { value: 'project_member', label: '项目成员' },
  { value: 'evaluation_recorder', label: '评价登记人' },
  { value: 'promotion_owner', label: '推广负责人' },
]
const statuses = [{ value: 0, label: '启用' }, { value: 1, label: '停用' }]

const idInput = input('项目类型记录主键；不是类型编码 typeCode', 'technology-project-type-list.list[].id，由用户选定一行', {
  type: 'string | number', required: true, constraints: ['数值须为安全正整数；字符串须为不带前导零的正十进制整数'],
})
const typeCodeInput = input('类型编码；新增时必填，编辑时由当前列表行保留且PC控件禁用', '用户在新增弹窗填写；编辑时来自 list[].typeCode', {
  type: 'string', required: true, constraints: ['不得为空或全为空格；前端固定版本没有长度或格式规则，SDK不擅自增加'],
})
const abbreviationInput = input('编号缩写；用于项目编号组成，页面允许不填', '用户填写；编辑时来自 list[].codeAbbreviation', {
  type: 'string', required: false, nullable: true, omitted: '新增时SDK发送null；编辑changes省略时保留current值', nullMeaning: '未填写编号缩写',
  constraints: ['非空时须为1至12位小写字母或数字，且首位是小写字母；空字符串也表示未填写并按页面原值提交'],
})
const roleCodesInput = input('适用角色编码数组，决定该项目类型可供哪些科技项目角色使用', '用户从PC固定四项中多选；编辑时来自 list[].roleCodes', {
  type: 'array', required: false, omitted: '新增时与PC默认一致，SDK选择全部四项；编辑changes省略时保留current数组',
  constraints: ['至少一项、不得重复；每个数组元素的新选择只能来自固定四项'],
})
const roleCodeItemInput = input('一个适用角色编码', '同一 roleCodes 数组中用户选中的值', {
  type: 'string', required: true, options: roles,
})
const typeNameInput = input('项目类型名称，页面列表显示此名称', '用户填写；编辑时来自 list[].typeName', {
  type: 'string', required: true, constraints: ['不得为空或全为空格；前端固定版本没有长度规则，SDK不擅自增加'],
})
const domainInput = input('项目大类；新增时选择，编辑时由当前列表行保留且PC控件禁用', '用户从PC固定三项中选择；编辑时来自 list[].projectDomain', {
  type: 'string', required: true, options: domains,
})
const statusInput = input('项目类型状态；这是新增/编辑表单字段，不是独立启停动作', '用户在弹窗单选；编辑时来自 list[].status', {
  type: 'integer', required: false, omitted: '新增时SDK默认数值0；编辑changes省略时保留current状态', options: statuses,
})
const sortInput = input('排序原值；页面未标单位，不做换算', '用户填写；编辑时来自 list[].sort', {
  type: 'number', required: false, nullable: true, omitted: '新增时SDK默认0；编辑changes省略时保留current排序', nullMeaning: '排序输入为空', constraints: ['须为非负有限数；PC只设置min=0，未限制为整数'],
})
const remarkInput = input('备注原文', '用户填写；编辑时来自 list[].remark', {
  type: 'string', required: false, nullable: true, omitted: '新增时SDK发送空字符串；编辑changes省略时保留current备注', nullMeaning: '后端或列表行未提供备注',
})

const createInputs: Record<string, AiParameter> = {
  typeCode: typeCodeInput,
  codeAbbreviation: abbreviationInput,
  roleCodes: roleCodesInput,
  'roleCodes[]': roleCodeItemInput,
  typeName: typeNameInput,
  projectDomain: domainInput,
  status: statusInput,
  sort: sortInput,
  remark: remarkInput,
}

function rowFields(prefix: string): AiField[] {
  const at = (key: string) => prefix ? `${prefix}.${key}` : key
  return [
    field(at('id'), 'string | number', '项目类型记录主键，用于编辑或删除；不是 typeCode'),
    field(at('typeCode'), 'string', '类型编码；编辑弹窗禁用，不可作为记录主键'),
    field(at('codeAbbreviation'), 'string', '编号缩写；空字符串表示未填写', { nullable: true, nullMeaning: '列表没有返回编号缩写，编辑时页面显示空值' }),
    field(at('roleCodes'), 'array', '适用角色编码数组；列表未返回时SDK按PC编辑弹窗逻辑补为全部四项'),
    field(at('roleCodes[]'), 'string', '一个适用角色编码', { constraints: [`页面已知值：${TECHNOLOGY_PROJECT_TYPE_ROLES.join('、')}；后端已有未知值会原样保留，不能擅自映射`] }),
    field(at('typeName'), 'string', '类型名称'),
    field(at('projectDomain'), 'string', '项目大类编码；页面映射 biology=生物、information=信息、engineering=工程，未知值原文显示', { values: { biology: '生物', information: '信息', engineering: '工程' }, constraints: ['未知值不自动归入已知三类'] }),
    field(at('status'), 'number', '状态；页面仅数值0显示启用，其余值显示停用', { values: { '0': '启用', '1': '停用' }, constraints: ['写入只接受数值0或1；读取未知数值按页面显示为停用，但不得声称等于标准值1'] }),
    field(at('sort'), 'number', '排序原值；页面未标单位', { nullable: true, nullMeaning: '列表未提供排序或排序为空，不等于0' }),
    field(at('remark'), 'string', '备注；只在新增/编辑弹窗消费', { nullable: true, nullMeaning: '未填写备注' }),
    field(at('updateTime'), 'string', '更新时间，页面原文显示；固定源码未声明格式或时区', { nullable: true, nullMeaning: '列表未提供更新时间', constraints: ['不据此推断时区或转换时间'] }),
  ]
}

function saveFields(prefix: string, includeId: boolean): AiField[] {
  const at = (key: string) => `${prefix}.${key}`
  return [
    ...(includeId ? [field(at('id'), 'string | number', '同一项目类型记录主键')] : []),
    field(at('typeCode'), 'string', '校验后的类型编码'),
    field(at('codeAbbreviation'), 'string', '校验后的编号缩写', { nullable: true, nullMeaning: '未填写编号缩写' }),
    field(at('roleCodes'), 'array', '校验后的适用角色编码数组'),
    field(at('roleCodes[]'), 'string', '一个适用角色编码'),
    field(at('typeName'), 'string', '校验后的类型名称'),
    field(at('projectDomain'), 'string', '项目大类编码'),
    field(at('status'), 'integer', '数值0启用或1停用', { values: { '0': '启用', '1': '停用' } }),
    field(at('sort'), 'number', '非负排序原值', { nullable: true, nullMeaning: '排序为空' }),
    field(at('remark'), 'string', '备注原文', { nullable: true, nullMeaning: '未填写备注' }),
  ]
}

const currentInput = input('编辑前的完整项目类型值；SDK只读取页面表单字段并忽略 updateTime', 'technology-project-type-list.list[]、prepare-update.previous 或调用方独立保存的最新列表行', {
  type: 'object', required: true, constraints: ['必须包含id/typeCode/roleCodes/typeName/projectDomain/status/sort/remark；typeCode和projectDomain只保留，不能通过changes修改'],
})
const changesInput = input('本次要改的可编辑字段；不含id、typeCode、projectDomain', '用户明确要求修改的字段', {
  type: 'object', required: false, omitted: '没有字段改变，仍会形成与current相同的草稿；调用方不应无意义提交', constraints: ['允许 codeAbbreviation/roleCodes/typeName/status/sort/remark；额外字段会被SDK忽略'],
})

const updateInputs: Record<string, AiParameter> = {
  current: currentInput,
  'current.id': idInput,
  'current.typeCode': typeCodeInput,
  'current.codeAbbreviation': { ...abbreviationInput, required: true },
  'current.roleCodes': { ...roleCodesInput, required: true },
  'current.roleCodes[]': roleCodeItemInput,
  'current.typeName': typeNameInput,
  'current.projectDomain': domainInput,
  'current.status': { ...statusInput, required: true },
  'current.sort': { ...sortInput, required: true },
  'current.remark': { ...remarkInput, required: true },
  changes: changesInput,
  'changes.codeAbbreviation': { ...abbreviationInput, source: '用户本次修改；省略则保留current.codeAbbreviation' },
  'changes.roleCodes': { ...roleCodesInput, source: '用户本次修改；省略则保留current.roleCodes' },
  'changes.roleCodes[]': roleCodeItemInput,
  'changes.typeName': { ...typeNameInput, required: false, source: '用户本次修改；省略则保留current.typeName' },
  'changes.status': { ...statusInput, source: '用户本次修改；省略则保留current.status' },
  'changes.sort': { ...sortInput, source: '用户本次修改；省略则保留current.sort' },
  'changes.remark': { ...remarkInput, source: '用户本次修改；省略则保留current.remark' },
}

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', 'SDK丢弃后端成功包络中的业务值；调用方以Promise正常完成识别请求已成功返回，不伪造记录ID或删除条数')],
  empty: '成功为根undefined，JSON无法编码该值；失败抛错。是否真正持久化仍须独立列表回查。',
}

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/technology.js@d3cf56bdc7:17-23', kind: 'reference', note: '证明项目类型菜单路径及权限；页面属于门户顶层无system菜单组。' },
  { source: 'app/portal/views/dashboard/technology/setting/project-type/list.vue@d3cf56bdc7:1-177', kind: 'reference', note: '证明分页筛选、列表字段、新增/编辑同一弹窗、表单校验、删除确认；没有独立详情、启停、导入导出或子页面。' },
  { source: 'app/portal/views/dashboard/technology/setting/shared.js@d3cf56bdc7:3-42', kind: 'reference', note: '证明项目大类/状态枚举及page/create/update/delete请求方法、路径和参数位置；未证明部署可用。' },
  { source: 'baseline/technology-project-type.browser.json', kind: 'browser', note: '2026-09-22测试环境页面可达，筛选、分页、新增/编辑/删除UI与固定源码一致；首个page GET及OPTIONS传输层HTTP均为200，但Portal标准包络/拦截器报业务失败“No static resource…”，表格0条。未执行任何写请求。' },
  { source: '2026-09-22 smoke/with-portal-token.sh SDK read smoke', kind: 'smoke', note: '共享接线后真实调用technologyProjectType.list；传输层成功但SDK按Portal标准业务包络抛出“请求资源不存在”，证明HTTP 200没有被误当成功。未调用写请求。' },
  { source: 'src/capabilities/technology-project-type.ts:createTechnologyProjectTypeCapability', kind: 'implementation', note: 'SDK请求投影、页面校验、编辑锁定字段及最终返回形状。' },
  { source: 'test/technology-project-type.test.ts', kind: 'test', note: '离线锁定请求、字段投影、校验、准备/恢复映射与AI契约；不等于浏览器或测试环境验证。' },
]
const gaps = [
  '浏览器已确认页面UI及page请求路径；首个GET传输层HTTP 200但业务包络报资源不存在，未取得成功请求的完整查询序列、上下文头或响应字段；当前成功请求契约仍来自固定前端d3cf56bdc7源码推导。',
  '固定后端dcb3f360194及本地origin/test/test引用均未找到technology/setting/project-type controller、DTO或数据库表，无法核对唯一性、引用删除保护、返回包络业务值及服务端字段约束；SDK只复刻PC实际请求，不补猜测。',
  '测试环境的浏览器与SDK读冒烟均确认：page GET及OPTIONS传输层HTTP为200，但Portal标准包络/拦截器报业务错误“请求资源不存在: No static resource admin-api/technology/setting/project-type/page.”；create/update/delete未调用，不能安全创建测试数据或完成清理闭环。写能力为已实现未真实验证。',
  '菜单permission为/dashboard/technology/setting/project-type，但页面route meta写/dashboard/technology/setting/template，疑似复用模板权限；当前资源不存在业务错误尚不能判定后端最终要求哪个权限码。',
]

function contract(purpose: string, effect: AiContract['effect'], inputs: Record<string, AiParameter>, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract {
  return {
    purpose,
    whenToUse: '操作门户系统“科技管理 → 设置 → 项目类型”页面；不用于财务项目的“项目类型”字典，也不用于科技项目实例或模板映射。',
    effect,
    boundaries: [
      '使用platform HTTP实例；请求路径已含/admin-api。该门户页面匹配不到module-type，SDK与浏览器一致不发送该头，不人为套用人力或平台模块号。',
      '只覆盖页面真实可达的分页查询、新增弹窗、编辑弹窗和删除确认。状态只能随新增/编辑保存，页面没有独立启停按钮；也没有详情、导入导出、打印或上传下载。',
      '编辑弹窗直接使用列表行，没有详情请求。调用方须保留最新列表行；SDK不能用不存在的详情接口补值。类型编码和项目大类在编辑态禁用，update不接受这两项changes。',
      '目录定义沿用菜单permission=/dashboard/technology/setting/project-type；页面route meta的template权限冲突保持为显式缺口，不据此改写请求。',
    ],
    prerequisites: ['已创建带当前会话token与tenantId的SDK；账号具备项目类型页面后端权限。菜单可见性不是后端权限证明。'],
    inputs,
    output,
    consume,
    steps: [],
    completion: '返回当前请求的结果并按契约交付；写请求正常完成后仍需用独立列表筛选逐字段核实。',
    failures: [
      '本地ID、分页、枚举、必填文本、角色、编号缩写或排序校验失败：不发业务请求，修正输入后再调用。',
      '401/403、HTTP错误、网络或后端业务包络错误：原样抛出，不当成空列表或保存成功；读请求恢复条件后可重试。测试环境已出现HTTP 200但业务报资源不存在，HTTP成功不能替代功能验证，也不能据此改猜其他URL。',
      '写请求超时或断网：结果不确定，先按原typeCode和typeName列表回查，再决定后续；禁止盲目重试或删除同名其他记录。',
    ],
    idempotency: effect === 'write' ? '没有SDK或后端幂等键，能力不接受requestId。重复create可能产生重复记录或业务错误；update/remove超时后先列表回查，不自动重发。' : null,
    evidence,
    gaps,
    ...extra,
  }
}

export const TECHNOLOGY_PROJECT_TYPE_CONTRACTS: Record<string, AiContract> = {}
const C = TECHNOLOGY_PROJECT_TYPE_CONTRACTS

C['technology-project-type-list'] = contract('按类型编码、类型名称、项目大类分页查询项目类型，并返回编辑弹窗所需字段。', 'read', {
  pageNo: input('从1开始的页码', '调用方分页状态', { type: 'integer', required: false, omitted: 'SDK默认1', constraints: ['正整数'] }),
  pageSize: input('本页请求条数', '调用方分页需要', { type: 'integer', required: false, omitted: 'SDK默认20，与PC默认一致', constraints: ['1至500整数；不接受-1全量'] }),
  code: input('类型编码筛选文本', '用户输入', { type: 'string', required: false, nullable: true, omitted: 'SDK发送null，不增加编码筛选', nullMeaning: '不增加编码筛选', constraints: ['固定前端未展示精确/模糊匹配口径，按后端实际结果解释'] }),
  name: input('类型名称筛选文本', '用户输入', { type: 'string', required: false, nullable: true, omitted: 'SDK发送null，不增加名称筛选', nullMeaning: '不增加名称筛选', constraints: ['固定前端未展示精确/模糊匹配口径，按后端实际结果解释'] }),
  projectDomain: { ...domainInput, required: false, nullable: true, omitted: 'SDK发送null，不限制项目大类', nullMeaning: '不限制项目大类' },
}, {
  shape: '{ list: array, total: integer }',
  fields: [field('$', 'object', '当前筛选页及符合条件的总数'), field('list', 'array', '当前页项目类型记录，不是全部结果'), field('list[]', 'object', '一条项目类型；只包含页面显示和编辑所需字段'), ...rowFields('list[]'), field('total', 'integer', '相同筛选条件下的总记录数，不是当前页长度')],
  empty: 'list=[]表示当前页无记录；只有total=0才表示当前筛选无记录。超过最后一页的空页不等于全局为空。',
}, [
  '展示typeCode/typeName/projectDomain/status/sort/updateTime；codeAbbreviation/roleCodes/remark供编辑弹窗使用，id只用于编辑和删除。',
  '需要完整结果时保持相同筛选递增pageNo，累计达到total或返回空页后停止，不能默认第一页就是全部。',
], {
  completion: '已取得所请求筛选页并说明分页范围；没有创建、修改或删除项目类型。',
  steps: [
    { role: 'optional', when: '用户选定一行并要编辑', capabilityId: 'technology-project-type-prepare-update', mapping: { current: 'result.list[]' }, instruction: '只取用户选中的一行，不把整个list传入；再把用户明确修改的字段放入changes。' },
    { role: 'optional', when: '用户选定一行并确认删除', capabilityId: 'technology-project-type-remove', mapping: { id: 'result.list[].id' }, instruction: '保留该行typeCode/typeName供删除后独立回查；不要按行号或同名第一条猜ID。' },
  ],
})

C['technology-project-type-prepare-create'] = contract('在本地复刻新增弹窗校验并补齐PC默认角色、状态、排序和备注，生成待提交草稿。', 'prepare', createInputs, {
  shape: '{ draft: object }', fields: [field('$', 'object', '只读新增准备结果'), field('draft', 'object', '可逐字段传给create的完整新增草稿'), ...saveFields('draft', false)],
  empty: '合法输入返回draft；校验失败抛错，不返回空草稿。',
}, ['本步骤不请求后端，不证明类型编码或名称唯一，也不分配记录ID。'], {
  completion: '只完成本地校验与默认值补齐；尚未新增项目类型。',
  steps: [{ role: 'required', when: '用户要求保存且draft已检查', capabilityId: 'technology-project-type-create', mapping: { typeCode: 'result.draft.typeCode', codeAbbreviation: 'result.draft.codeAbbreviation', roleCodes: 'result.draft.roleCodes', typeName: 'result.draft.typeName', projectDomain: 'result.draft.projectDomain', status: 'result.draft.status', sort: 'result.draft.sort', remark: 'result.draft.remark' }, instruction: '逐字段传create；不要添加id、updateTime或模板字段。' }],
})

C['technology-project-type-prepare-update'] = contract('以最新列表行为当前值，只合并页面允许编辑的字段，并保留编辑前快照。', 'prepare', updateInputs, {
  shape: '{ draft: object, previous: object }', fields: [field('$', 'object', '编辑准备结果，尚未发送PUT'), field('draft', 'object', '合并后的完整更新草稿'), ...saveFields('draft', true), field('previous', 'object', '准备时列表行的页面字段快照，不是服务端历史版本'), ...saveFields('previous', true)],
  empty: 'current缺字段或changes非法时抛错；没有详情接口可返回空值后继续。',
}, ['确认draft.id与previous.id相同；typeCode和projectDomain由current原样保留。', 'previous仅用于本次恢复；列表行可能在读取后被并发修改，prepare不会锁记录。'], {
  completion: '已形成更新草稿和旧快照，未写入。',
  steps: [
    { role: 'required', when: '用户要求保存此次编辑', capabilityId: 'technology-project-type-update', mapping: { current: 'result.draft', changes: 'literal:{}' }, instruction: '把完整draft作为current并传空changes；update会再次本地校验后PUT。' },
    { role: 'cancel', when: '此次编辑已保存、用户要求恢复且已确认没有要保留的并发修改', capabilityId: 'technology-project-type-update', mapping: { current: 'result.draft', 'changes.codeAbbreviation': 'result.previous.codeAbbreviation', 'changes.roleCodes': 'result.previous.roleCodes', 'changes.typeName': 'result.previous.typeName', 'changes.status': 'result.previous.status', 'changes.sort': 'result.previous.sort', 'changes.remark': 'result.previous.remark' }, instruction: '恢复是再次PUT，不是服务端回滚；typeCode/projectDomain本就不可编辑。恢复后仍须列表回查。' },
  ],
})

C['technology-project-type-create'] = contract('按新增弹窗字段创建项目类型；SDK发送id=null并忽略后端成功业务值。', 'write', createInputs, voidOutput, ['保存前建议先prepare-create；成功后按typeCode和typeName列表筛选并精确核对全部表单字段。'], {
  completion: 'Promise正常完成仅表示创建请求成功返回；独立列表中找到唯一精确匹配行并核对字段后才可报告创建已验证。',
  steps: [{ role: 'required', when: '创建正常完成或写请求超时需要核实', capabilityId: 'technology-project-type-list', mapping: { code: 'args.typeCode', name: 'args.typeName' }, instruction: '逐页查找typeCode与typeName都精确匹配的行，再核对项目大类、角色、状态、排序、缩写和备注；0条或多条都不能猜。' }],
})

C['technology-project-type-update'] = contract('使用最新列表行和用户改动保存项目类型；类型编码和项目大类保持不变。', 'write', updateInputs, voidOutput, ['SDK本地执行与prepare-update相同的合并校验后PUT完整页面表单；不需要也不会调用不存在的详情接口。'], {
  completion: 'PUT正常完成后，以current.typeCode和目标typeName列表回查同一ID且字段一致，才报告编辑已验证。',
  steps: [{ role: 'required', when: '更新正常完成或超时后核实结果', capabilityId: 'technology-project-type-list', mapping: { code: 'args.current.typeCode', name: 'args.changes.typeName' }, instruction: 'changes.typeName省略时改用args.current.typeName；定位相同id并核对所有目标字段，不能以同名另一行代替。' }],
})

C['technology-project-type-remove'] = contract('按列表行主键删除一个项目类型；页面会先显示确认框，SDK只执行已确认的删除。', 'write', { id: idInput }, voidOutput, ['调用前保留被选行的typeCode/typeName；删除后以相同条件分页查询，确认原ID不再出现。没有恢复接口。'], {
  completion: 'DELETE正常完成不等于独立证实删除；相同筛选结果中原ID不再出现后才报告删除已验证。',
  steps: [{ role: 'required', when: '删除正常完成或超时需要核实', capabilityId: 'technology-project-type-list', mapping: { code: 'context.selectedTypeCode', name: 'context.selectedTypeName' }, instruction: 'context值必须来自调用remove前保留的所选list行；逐页确认args.id不再出现。若仍存在，不自动再次删除。' }],
})

export const TECHNOLOGY_PROJECT_TYPE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(TECHNOLOGY_PROJECT_TYPE_METHODS).map(([capabilityId, method]) => {
    const source = C[capabilityId]!
    const signature = method === 'remove'
      ? `公开方法technologyProjectType.${method}(id)接收单个位置参数；能力invoke接收{id}对象。`
      : `公开方法technologyProjectType.${method}(input)接收单个对象参数；字段与inputs一致。`
    return [`technologyProjectType.${method}`, { ...source, boundaries: [...source.boundaries, signature] }]
  }),
)

// Keep the runtime enums and the documented options from drifting silently.
if (domains.map(item => item.value).join(',') !== TECHNOLOGY_PROJECT_DOMAINS.join(',') || roles.map(item => item.value).join(',') !== TECHNOLOGY_PROJECT_TYPE_ROLES.join(',')) {
  throw new Error('项目类型AI契约枚举与执行实现不一致')
}
