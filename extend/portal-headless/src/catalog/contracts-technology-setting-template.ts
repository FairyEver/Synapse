import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  TECHNOLOGY_SETTING_TEMPLATE_DOMAINS,
  TECHNOLOGY_SETTING_TEMPLATE_METHODS,
  TECHNOLOGY_SETTING_TEMPLATE_PAGE_PATH,
  TECHNOLOGY_SETTING_TEMPLATE_PERMISSION,
  TECHNOLOGY_SETTING_TEMPLATE_STATUSES,
  TECHNOLOGY_SETTING_TEMPLATE_VERSION_STATUSES,
  technologySettingTemplateCapabilities,
} from '../capabilities/technology-setting-template.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })
const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const definitions = new Map(technologySettingTemplateCapabilities.map(definition => [definition.id, definition]))

const domainOptions = TECHNOLOGY_SETTING_TEMPLATE_DOMAINS.map(value => ({
  value,
  label: value === 'biology' ? '生物' : value === 'information' ? '信息' : '工程',
}))
const statusOptions = TECHNOLOGY_SETTING_TEMPLATE_STATUSES.map(value => ({ value, label: value === 0 ? '启用' : '停用' }))
const versionStatusOptions = TECHNOLOGY_SETTING_TEMPLATE_VERSION_STATUSES.map(value => ({
  value,
  label: value === 'draft' ? '草稿' : value === 'published' ? '已发布' : '已停用',
}))

const idInput = param('模板族或模板版本的主键；不能用编码、名称或列表下标替代。', '同一页面最近一次模板/版本列表结果中的id，或上一步create返回的根ID。', {
  type: 'string | number',
  required: true,
  constraints: ['数值须为安全正整数；字符串须是不带前导零的正十进制整数。'],
})
const templateCodeInput = param('模板编码；模板族的业务编码。编辑时页面禁用。', '新建表单填写；编辑时来自模板列表行.templateCode。', {
  type: 'string',
  required: true,
  constraints: ['不得为空或全为空格；固定Portal源码没有声明长度或格式上限，SDK不擅自增加。'],
})
const templateNameInput = param('模板名称；模板族在列表和版本抽屉标题中的名称。', '新建表单填写；编辑时来自列表行或用户修改。', {
  type: 'string',
  required: true,
  constraints: ['不得为空或全为空格；固定Portal源码没有声明长度上限。'],
})
const projectDomainInput = param('项目大类编码；决定模板属于生物、信息或工程。编辑时页面禁用。', '用户从页面固定三项中选择；编辑时来自列表行.projectDomain。', {
  type: 'string',
  required: true,
  options: domainOptions,
})
const templateStatusInput = param('模板族状态：0启用、1停用；这是基本信息表单字段，不是独立启停请求。', '新建默认0；编辑时来自列表行或用户明确修改。', {
  type: 'integer',
  required: false,
  default: '0',
  options: statusOptions,
})
const templateRemarkInput = param('模板族备注原文。', '用户在基本信息表单填写；省略时页面表单默认空字符串。', {
  type: 'string | null',
  required: false,
  nullable: true,
  omitted: '新建提交空字符串；编辑省略changes.remark时保留current.remark。',
  nullMeaning: '调用方明确没有备注，SDK按页面保存语义归一为空字符串或保留当前值。',
})
const versionNoInput = param('版本号；同一模板族下的版本标识。', '新建/复制版本表单填写；新建模板的首个版本来自基本信息弹窗。', {
  type: 'string',
  required: true,
  constraints: ['不得为空或全为空格；新建模板首个版本最多32个字符，固定版本弹窗没有另外声明上限。'],
})
const versionNameInput = param('版本名称；版本列表展示名称。', '新建/复制版本表单填写；复制时页面默认在来源名称后追加“（副本）”。', {
  type: 'string',
  required: true,
  constraints: ['不得为空或全为空格；新建模板首个版本最多100个字符，固定版本弹窗没有另外声明上限。'],
})
const sourceVersionIdInput = param('复制来源版本ID；新建草稿时传null，复制时必须传来源版本的id。', '版本列表行.id；页面根据sourceVersionId是否有值选择create或copy端点。', {
  type: 'string | number | null',
  required: true,
  nullable: true,
  nullMeaning: '不复制已有版本，调用/version/create。',
})
const versionRemarkInput = param('版本变更说明原文。', '新建/复制版本表单；复制时页面默认写入“复制自 {sourceVersionNo}”。', {
  type: 'string | null',
  required: false,
  nullable: true,
  omitted: 'SDK按页面发送空字符串。',
  nullMeaning: '没有版本变更说明。',
})
const currentStatusInput = param('版本当前绝对状态；用于复刻页面按钮可见条件，不作为后端请求字段发送。', '同一版本列表行.versionStatus。', {
  type: 'string',
  required: true,
  options: versionStatusOptions,
  constraints: ['publish只接受currentStatus=draft；disable只接受currentStatus=published；不要把动作当作toggle。'],
})

const listInputs: Record<string, AiParameter> = {
  pageNo: param('从1开始的页码。', '调用方分页状态。', { type: 'integer', required: false, default: '1', constraints: ['正整数。'] }),
  pageSize: param('当前页请求条数。', '调用方分页状态；页面默认20。', { type: 'integer', required: false, default: '20', constraints: ['正整数；页面没有声明-1全量语义。'] }),
  code: param('模板编码筛选文本。', '用户在页面“编码”输入框填写。', { type: 'string', required: false, nullable: true, omitted: 'SDK发送null，不增加编码筛选。', nullMeaning: '不按模板编码筛选。' }),
  name: param('模板名称筛选文本。', '用户在页面“名称”输入框填写。', { type: 'string', required: false, nullable: true, omitted: 'SDK发送null，不增加名称筛选。', nullMeaning: '不按模板名称筛选。' }),
  projectDomain: { ...projectDomainInput, required: false, nullable: true, omitted: 'SDK发送null，不限制项目大类。', nullMeaning: '不按项目大类筛选。' },
}

const templateInputs: Record<string, AiParameter> = {
  templateCode: templateCodeInput,
  templateName: templateNameInput,
  projectDomain: projectDomainInput,
  status: templateStatusInput,
  remark: templateRemarkInput,
}
const templateCreateFormInputs: Record<string, AiParameter> = {
  ...templateInputs,
  versionNo: versionNoInput,
  versionName: versionNameInput,
}
const currentInput = param('编辑前的完整模板列表行；编辑没有详情请求，必须来自当前列表。', 'technology-setting-template-list.list[]或调用方保留的同一列表行。', {
  type: 'object',
  required: true,
  constraints: ['必须包含id、templateCode、templateName、projectDomain、status和remark；templateCode/projectDomain只保留，不通过changes修改。'],
})
const changesInput = param('本次要编辑的基本信息变更；只允许模板名称、状态、备注。', '用户明确修改的字段；省略字段沿用current。', {
  type: 'object | null',
  required: false,
  nullable: true,
  omitted: '按current完整值提交；没有变化时不应无意义发PUT。',
  nullMeaning: '没有编辑变更，保留current。',
  constraints: ['禁止通过changes传id、templateCode或projectDomain；额外字段会被SDK拒绝。'],
})
const updateInputs: Record<string, AiParameter> = {
  current: currentInput,
  'current.id': { ...idInput, source: 'technology-setting-template-list.list[].id；与current对象同一行。' },
  'current.templateCode': { ...templateCodeInput, source: 'technology-setting-template-list.list[].templateCode；编辑时页面禁用。' },
  'current.templateName': { ...templateNameInput, source: 'technology-setting-template-list.list[].templateName。' },
  'current.projectDomain': { ...projectDomainInput, source: 'technology-setting-template-list.list[].projectDomain；编辑时页面禁用。' },
  'current.status': { ...templateStatusInput, required: true, source: 'technology-setting-template-list.list[].status。' },
  'current.remark': { ...templateRemarkInput, required: true, source: 'technology-setting-template-list.list[].remark。' },
  changes: changesInput,
  'changes.templateName': { ...templateNameInput, required: false, source: '用户本次要修改的templateName；省略则保留current。' },
  'changes.status': { ...templateStatusInput, required: false, source: '用户本次要修改的status；省略则保留current。' },
  'changes.remark': { ...templateRemarkInput, required: false, source: '用户本次要修改的remark；省略则保留current。' },
}
const initialVersionInputs: Record<string, AiParameter> = {
  templateId: { ...idInput, meaning: '刚创建的模板族ID；从模板基本信息create返回值取得。', source: 'technology-setting-template-create根返回值。' },
  versionNo: versionNoInput,
  versionName: versionNameInput,
}
const versionInputs: Record<string, AiParameter> = {
  templateId: { ...idInput, meaning: '模板族ID；版本属于该模板族。', source: '模板列表行.id或版本抽屉当前模板.id。' },
  sourceVersionId: sourceVersionIdInput,
  versionNo: { ...versionNoInput, constraints: ['不得为空或全为空格；固定版本弹窗未声明长度上限。'] },
  versionName: { ...versionNameInput, constraints: ['不得为空或全为空格；固定版本弹窗未声明长度上限。'] },
  remark: versionRemarkInput,
}
const actionInputs: Record<string, AiParameter> = {
  id: { ...idInput, meaning: '模板版本主键；来自当前版本列表行.id。' },
  currentStatus: currentStatusInput,
}
const versionConfigIdInput = param('模板版本配置的版本主键；用于读取或保存同一版本的配置。', '当前版本列表行.id或版本创建返回的根ID。', {
  type: 'string | number',
  required: true,
  constraints: ['数值须为安全正整数；不能使用模板族ID、版本号或列表下标。'],
})
const versionConfigNodesInput = param('Portal编辑器构造的扁平节点配置数组；节点顺序、父节点、配置项顺序都会写入后端。', '读取配置和节点树后，由调用方按编辑器当前选择结果构造。', {
  type: 'object[]',
  required: true,
  constraints: ['每个节点必须含sourceNodeId、parentSourceNodeId、sort、items；items只提交templateItemId、displayName、isRequired、sort；不能把nodeName、children、itemType等展示字段混入保存体。'],
})
const versionConfigSaveInputs: Record<string, AiParameter> = {
  templateVersionId: versionConfigIdInput,
  nodes: versionConfigNodesInput,
}

const templateRowFields: AiField[] = [
  field('$', 'object', '模板族分页结果；list是当前页，total是相同筛选条件下的总数。'),
  field('list', 'array', '当前页模板族列表。'),
  field('list[]', 'object', '一条模板族列表行；页面基本信息编辑和删除直接消费该行。'),
  field('list[].id', 'string | number', '模板族主键；编辑、删除和加载版本使用；不是templateCode。'),
  field('list[].templateCode', 'string', '模板编码；列表展示，编辑时保留且页面禁用。'),
  field('list[].templateName', 'string', '模板名称；列表和版本抽屉标题展示。'),
  field('list[].projectDomain', 'string', '项目大类编码；biology=生物、information=信息、engineering=工程，未知值原样保留。', { values: { biology: '生物', information: '信息', engineering: '工程' } }),
  field('list[].status', 'number', '模板族状态；页面只把数值0显示为启用，其余数值显示为停用；写入只允许0/1。', { values: { '0': '启用', '1': '停用' }, constraints: ['读取未知数值不能擅自改写成1。'] }),
  field('list[].remark', 'string | null', '模板族备注原文。', { nullable: true, nullMeaning: '后端没有返回备注。' }),
  field('list[].updateTime', 'string | number | null', '更新时间原值；页面直接展示，不做时区或格式推断。', { nullable: true, nullMeaning: '后端没有返回更新时间。' }),
  field('total', 'integer', '符合筛选条件的模板族总数，不是当前页长度。'),
]
const versionRowFields: AiField[] = [
  field('$', 'object', '模板版本分页结果；页面固定请求第一页最多500条。'),
  field('list', 'array', '当前模板族的版本列表。'),
  field('list[]', 'object', '一条模板版本列表行。'),
  field('list[].id', 'string | number', '模板版本主键；配置/查看、复制、发布和停用使用。'),
  field('list[].versionNo', 'string', '版本号。'),
  field('list[].versionName', 'string', '版本名称。'),
  field('list[].versionStatus', 'string', '版本绝对状态；draft=草稿、published=已发布、disabled=已停用，未知值原样保留。', { values: { draft: '草稿', published: '已发布', disabled: '已停用' } }),
  field('list[].publishTime', 'string | number | null', '发布时间原值；草稿或后端未返回时为空，不做时区换算。', { nullable: true, nullMeaning: '未发布或后端没有返回发布时间。' }),
  field('total', 'integer', '当前模板族的版本总数；页面用它判断500条是否取全。'),
]
const templateDraftFields: AiField[] = [
  field('$', 'object', '新建模板本地准备结果；尚未请求服务端。'),
  field('draft', 'object', '包含模板基本信息草稿与首个版本草稿。'),
  field('draft.template', 'object', '可交给模板create的基本信息请求体；id固定为null。'),
  field('draft.template.id', 'null', '新建模板尚无ID；不要把它传成版本ID。'),
  field('draft.template.templateCode', 'string', '模板编码。'),
  field('draft.template.templateName', 'string', '模板名称。'),
  field('draft.template.projectDomain', 'string', '项目大类编码。'),
  field('draft.template.status', 'integer', '模板状态；0启用、1停用。'),
  field('draft.template.remark', 'string', '模板备注；空值归一为空字符串。'),
  field('draft.initialVersion', 'object', '首个版本的本地表单字段；必须在模板create返回ID后再提交。'),
  field('draft.initialVersion.versionNo', 'string', '首个版本号。'),
  field('draft.initialVersion.versionName', 'string', '首个版本名称。'),
]
const updateDraftFields: AiField[] = [
  field('$', 'object', '模板基本信息编辑准备结果；尚未发送PUT。'),
  field('draft', 'object', '合并后的完整模板更新请求体。'),
  field('draft.id', 'string | number', '当前模板族主键。'),
  field('draft.templateCode', 'string', '当前模板编码；页面禁用，更新时原样保留。'),
  field('draft.templateName', 'string', '当前或修改后的模板名称。'),
  field('draft.projectDomain', 'string', '当前项目大类；页面禁用，更新时原样保留。'),
  field('draft.status', 'integer', '当前或修改后的模板状态；0启用、1停用。'),
  field('draft.remark', 'string | null', '当前或修改后的模板备注。', { nullable: true, nullMeaning: '当前列表行没有备注。' }),
  field('previous', 'object', '编辑前快照；用于展示或恢复判断，不是服务端历史版本。'),
  field('previous.id', 'string | number', '编辑前模板族主键。'),
  field('previous.templateCode', 'string', '编辑前模板编码。'),
  field('previous.templateName', 'string', '编辑前模板名称。'),
  field('previous.projectDomain', 'string', '编辑前项目大类。'),
  field('previous.status', 'number', '编辑前模板状态。'),
  field('previous.remark', 'string | null', '编辑前模板备注。', { nullable: true, nullMeaning: '编辑前列表行没有备注。' }),
]
const initialVersionDraftFields: AiField[] = [
  field('$', 'object', '首个版本本地准备结果；尚未发送POST。'),
  field('draft', 'object', '版本创建请求体。'),
  field('draft.templateId', 'string | number', '已经创建的模板族ID。'),
  field('draft.versionNo', 'string', '首个版本号。'),
  field('draft.versionName', 'string', '首个版本名称。'),
]
const versionDraftFields: AiField[] = [
  field('$', 'object', '模板版本本地准备结果；尚未发送POST。'),
  field('draft', 'object', '版本创建或复制请求体。'),
  field('draft.templateId', 'string | number', '所属模板族ID。'),
  field('draft.sourceVersionId', 'string | number | null', '复制来源版本ID；新建版本为null。', { nullable: true, nullMeaning: '创建全新草稿，不复制已有版本。' }),
  field('draft.versionNo', 'string', '版本号。'),
  field('draft.versionName', 'string', '版本名称。'),
  field('draft.remark', 'string', '版本变更说明；空值归一为空字符串。'),
]
const versionConfigFields: AiField[] = [
  field('$', 'object', '模板版本配置对象；编辑器头部、节点树和末级节点配置项共同消费。'),
  field('templateVersionId', 'string | number | null', '模板版本主键；用于再次保存配置和发布该版本。', { optional: true, nullable: true, nullMeaning: '后端未回显版本ID；调用方仍应使用请求时的版本ID。' }),
  field('templateName', 'string | null', '模板族名称；编辑器头部展示。', { optional: true, nullable: true, nullMeaning: '后端未回显模板名称。' }),
  field('projectDomain', 'string | null', '项目大类编码；用于加载对应节点树和配置项候选。', { optional: true, nullable: true, nullMeaning: '后端未回显项目大类。' }),
  field('versionNo', 'string | null', '版本号；编辑器头部展示。', { optional: true, nullable: true, nullMeaning: '后端未回显版本号。' }),
  field('versionName', 'string | null', '版本名称；编辑器头部展示。', { optional: true, nullable: true, nullMeaning: '后端未回显版本名称。' }),
  field('versionStatus', 'string', '版本绝对状态；draft可编辑和保存，published/disabled不可编辑。'),
  field('editable', 'boolean', '是否允许编辑器保存和发布；页面以此控制按钮与节点/配置项编辑。'),
  field('updateTime', 'string | number | null', '配置最后更新时间原值；编辑器头部展示。', { optional: true, nullable: true, nullMeaning: '后端未回显更新时间。' }),
  field('nodes', 'array', '版本当前选择的节点配置；可能包含祖先节点和末级节点。'),
  field('nodes[]', 'object', '一条版本节点配置；保留Portal树展示字段，同时用sourceNodeId关联模板节点。'),
  field('nodes[].sourceNodeId', 'string | number', '来源节点ID；与模板节点树的id对应。'),
  field('nodes[].parentSourceNodeId', 'string | number | null', '来源父节点ID；根节点为null。', { nullable: true, nullMeaning: '该节点是来源树根节点。' }),
  field('nodes[].sort', 'integer', '节点在来源树中的排序值。'),
  field('nodes[].items', 'array', '该节点下的配置项；只有末级节点应有可编辑配置项。'),
  field('nodes[].items[]', 'object', '一条配置项；页面显示名称、必填开关和顺序。'),
  field('nodes[].items[].templateItemId', 'string | number', '模板配置项ID；与模板基础配置的item id对应。'),
  field('nodes[].items[].displayName', 'string', '当前版本中的显示名称；编辑器可直接修改，允许空字符串。'),
  field('nodes[].items[].isRequired', 'boolean', '字段是否在版本中必填；业务组件由页面保存时归一为false。'),
  field('nodes[].items[].sort', 'integer', '配置项在当前末级节点内的顺序。'),
  field('nodes[].children', 'array', '来源树展示用的子节点；保存时由Portal从节点树重建，不直接提交。', { optional: true }),
]
const versionConfigSaveDraftFields: AiField[] = [
  field('$', 'object', '模板版本配置保存请求体；尚未发送PUT。'),
  field('draft', 'object', '可直接交给saveVersionConfig的规范化请求体。'),
  field('draft.templateVersionId', 'string | number', '待保存的模板版本主键。'),
  field('draft.nodes', 'array', '扁平节点数组；每项只包含后端保存所需字段。'),
  field('draft.nodes[]', 'object', '一个节点保存项。'),
  field('draft.nodes[].sourceNodeId', 'string | number', '来源节点ID。'),
  field('draft.nodes[].parentSourceNodeId', 'string | number | null', '来源父节点ID；根节点为null。', { nullable: true, nullMeaning: '根节点。' }),
  field('draft.nodes[].sort', 'integer', '节点排序值。'),
  field('draft.nodes[].items', 'array', '该节点的配置项保存数组。'),
  field('draft.nodes[].items[]', 'object', '一个配置项保存项。'),
  field('draft.nodes[].items[].templateItemId', 'string | number', '模板配置项ID。'),
  field('draft.nodes[].items[].displayName', 'string', '版本显示名称；允许空字符串，按Portal原样保存。'),
  field('draft.nodes[].items[].isRequired', 'boolean', '是否必填。'),
  field('draft.nodes[].items[].sort', 'integer', '配置项顺序。'),
]
const idOutput: AiContract['output'] = {
  shape: 'string | number',
  fields: [field('$', 'string | number', '新建模板族或模板版本的主键；仅代表服务端返回了ID。')],
  empty: '没有合法ID、请求失败或响应结构不符合页面消费时抛错；新建ID仍必须通过列表/版本列表回查确认。',
}
const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', 'Portal成功回执没有被页面消费的业务数据；Promise正常完成只表示请求未抛错。')],
  empty: '请求、权限或业务错误抛出；undefined不包含更新后的模板、删除条数或最终版本状态。',
}

const boundaries = [
  `覆盖模板中心页面${TECHNOLOGY_SETTING_TEMPLATE_PAGE_PATH}及其按钮可达的版本编辑器：模板族/版本列表、模板基本信息新建编辑删除、版本新建复制、配置读取保存、发布停用。页面菜单和路由权限均为${TECHNOLOGY_SETTING_TEMPLATE_PERMISSION}。`,
  '页面使用platform HTTP实例；该路径不命中Portal module-type规则，SDK与浏览器一致不发送module-type。会话token与tenantId仍由SDK会话绑定提供。',
  '模板列表编辑直接使用当前列表行，没有详情请求；templateCode和projectDomain在编辑弹窗禁用，update只允许templateName、status、remark变化。',
  '配置模板按钮从版本列表跳转到独立的/template/editor/[id]页面；编辑器读取版本配置，并按projectDomain读取节点树和启用的字段/组件候选。节点树和字段/组件候选由模板基础配置能力提供，版本配置读取/保存由本能力提供。',
  '固定页面没有tabs组件、详情GET、导入、导出、下载或上传动作；不存在的页面动作不在SDK目录中虚构。',
]
const prerequisites = [
  '使用当前用户、当前租户的会话token创建platform实例，并确认账号具有模板中心菜单及相应后端权限。菜单可见不等于写权限已验证。',
  '编辑、删除、版本动作的ID必须来自同一次或更新后的页面列表；版本发布/停用前必须保留列表行的绝对versionStatus。',
  '写请求正常完成或结果不确定后都要通过列表/版本列表回查；没有requestId时不盲目重复产生创建或复制副作用。',
]
const failures = [
  '分页、ID、枚举、必填文本或版本长度校验失败时，SDK在请求前抛错，不发送业务请求；状态动作不满足页面按钮条件时同样不请求。',
  '401/403、HTTP错误、网络错误或Portal业务包络错误原样抛出；列表响应缺少list/total或行缺少页面消费字段时抛错，不降级为空列表。',
  '模板create成功但首个版本create失败时，保留模板ID并只重试版本步骤；版本create/copy成功但路由跳转失败时，保留版本ID并让调用方继续配置，不重复创建。',
  '写请求超时或响应丢失时，先按ID、编码/名称或版本号回查；无法唯一定位时报告不确定，不自动重发、删除或覆盖其他记录。',
]
const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main@acab69acc7: app/portal/views/dashboard/technology/setting/template/list.vue:1-458', kind: 'reference', note: '逐行核对列表筛选、默认分页、模板基本信息表单、版本抽屉、初始版本/新建/复制、状态动作、路由跳转、按钮条件和无导入导出UI。' },
  { source: 'CodeReview_Projects_Js@test/portal/main@acab69acc7: app/portal/views/dashboard/technology/setting/shared.js:1-61', kind: 'reference', note: '核对platform实例、域/状态枚举，以及模板族、版本和版本配置端点的HTTP方法、params/data位置。' },
  { source: 'CodeReview_Projects_Js@test/portal/main@acab69acc7: app/portal/views/dashboard/technology/setting/template/editor/[id].vue:1-385', kind: 'reference', note: '核对编辑器初始化、节点/配置项候选加载、展示字段与保存字段投影，以及发布前先保存配置的顺序。' },
  { source: 'CodeReview_Projects_Js@test/portal/main@acab69acc7: app/portal/menus/technology.js:26-27 与 app/portal/views/dashboard/technology/setting/template.vue:1-4', kind: 'reference', note: '核对页面路径、菜单permission和路由外壳permission。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test@0f1a55718eb', kind: 'reference', note: '固定Java检出未找到technology/setting/template相关controller、DTO、service或表；后端返回包络、唯一性、删除保护及服务端字段校验未能独立核对。' },
  { source: 'src/capabilities/technology-setting-template.ts', kind: 'implementation', note: '锁定页面请求投影、编辑器配置读写、表单校验、module-type空值、状态门禁和最终返回形状。' },
  { source: 'test/technology-setting-template.test.ts', kind: 'test', note: '离线锁定逐端点请求、字段投影、表单/状态规则、页面源码动作和关键映射反证；不替代真实页面或真实写入回查。' },
  { source: 'docs/pages/模板中心.md', kind: 'reference', note: '记录四件套：能力定义、参数契约、逐字段基准和操作步骤，并区分实测与推断。' },
]
const gaps = [
  '本工作单位未启动浏览器，未取得真实账号的页面网络基准、成功业务包络或页面权限结果；所有请求/字段形状来自固定Portal源码和离线stub。',
  '固定Java检出@0f1a55718eb未找到本页端点对应后端实现，无法独立证明服务端唯一性、删除保护、返回ID包络、字段长度和版本状态流转；这些未验证内容不写成SDK能力保证。',
  '没有执行真实模板创建、首版创建、编辑、版本复制/配置保存/发布/停用/删除以及写后列表回查；写能力的prepare→submit→回查步骤已写入契约，但证据边界仍为推断。',
  '未启动真实template/editor/[id].vue页面，节点树、字段/组件候选和版本配置接口仍只有固定Portal源码与离线stub证据；未把离线通过说成真实环境已交付。',
]

function base(purpose: string, effect: AiContract['effect'], inputs: Record<string, AiParameter>, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract {
  return {
    purpose,
    whenToUse: `需要在Portal模板中心页面${TECHNOLOGY_SETTING_TEMPLATE_PAGE_PATH}执行该项查询、准备或写入动作时使用。`,
    boundaries,
    effect,
    prerequisites,
    inputs,
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? '请求按页面端点完成；必须按steps中的列表回查确认业务终态。' : effect === 'prepare' ? '得到通过页面规则的本地草稿；尚未改变服务端。' : '返回页面实际消费的数据；查询本身不改变服务端。',
    failures,
    idempotency: effect === 'write' ? '页面没有requestId幂等键。create/copy或超时写请求先回查再决定是否重试；update/remove/status动作也不在未核实前盲目重发。' : null,
    evidence,
    gaps,
    ...extra,
  }
}

const contracts: Record<string, AiContract> = {}
const C = contracts

C['technology-setting-template-list'] = base('按模板编码、模板名称和项目大类分页查询模板族，返回基本信息编辑、删除和版本管理所需的页面字段。', 'read', listInputs, {
  shape: '{ list: object[], total: integer }',
  fields: templateRowFields,
  empty: 'list=[]表示当前页没有模板；total=0才表示当前筛选无模板。权限、网络、业务错误或响应字段缺失会抛错，不降级为空列表。',
}, [
  '展示list[]的templateCode、templateName、projectDomain、status和updateTime；remark供编辑，id用于编辑、删除和版本查询。',
  '需要翻页时继续使用相同筛选递增pageNo，直到已读数量达到total或返回空页；不能把第一页当成全部。',
], {
  steps: [
    { role: 'optional', when: '用户要编辑某条模板基本信息', capabilityId: 'technology-setting-template-prepare-update', mapping: { current: 'result.list[]' }, instruction: '只传用户选中的同一列表行；页面没有详情接口，不能用名称或行号代替current。' },
    { role: 'optional', when: '用户要打开版本管理或配置模板', capabilityId: 'technology-setting-template-version-list', mapping: { templateId: 'result.list[].id' }, instruction: '用当前模板族id读取版本；页面固定一次请求pageNo=1、pageSize=500，total不等于list.length时不能认定版本已取全。' },
  ],
  completion: '已取得当前筛选页和total；本能力不修改模板。',
})

C['technology-setting-template-prepare-create'] = base('按模板中心新建弹窗规则准备模板族基本信息和首个版本的本地草稿，不发送请求。', 'prepare', templateCreateFormInputs, {
  shape: '{ draft: { template: object, initialVersion: object } }',
  fields: templateDraftFields,
  empty: '模板编码、模板名称、项目大类、版本号或版本名称不合规则时抛错且不发送POST。',
}, ['展示draft供用户确认；template可先交给template-create，拿到模板ID后再把initialVersion交给technologySettingTemplate.createInitialVersion。'], {
  steps: [
    { role: 'required', when: '用户确认保存模板基本信息', capabilityId: 'technology-setting-template-create', mapping: { templateCode: 'result.draft.template.templateCode', templateName: 'result.draft.template.templateName', projectDomain: 'result.draft.template.projectDomain', status: 'result.draft.template.status', remark: 'result.draft.template.remark' }, instruction: '只提交draft.template；不要把versionNo/versionName混入模板create请求。' },
    { role: 'required', when: 'template-create返回模板ID且用户确认继续创建首个版本', capabilityId: 'technology-setting-template-version-create-initial', mapping: { templateId: 'user.templateCreateResult', versionNo: 'result.draft.initialVersion.versionNo', versionName: 'result.draft.initialVersion.versionName' }, instruction: '把create返回的根ID与同一份initialVersion组合；模板已创建时只提交版本，不重复创建模板。' },
    { role: 'cancel', when: '用户取消新建', instruction: '丢弃本地draft，不调用任何写能力。' },
  ],
  completion: '得到尚未写入服务端的模板和首个版本草稿。',
})

C['technology-setting-template-create'] = base('新建一条模板族基本信息；版本字段不属于此端点。', 'write', templateInputs, idOutput, ['页面新建流程先POST模板基本信息，再用返回ID创建首个版本；本能力只完成第一步。返回ID或超时后按模板ID/编码和名称回查列表。'], {
  steps: [
    { role: 'recovery', when: 'POST成功、超时或响应丢失后核实模板基本信息', capabilityId: 'technology-setting-template-list', mapping: {}, instruction: '用提交前保留的templateCode/templateName/projectDomain筛选并分页，确认唯一记录和字段；无法唯一定位时不能报告已创建或盲目重试。' },
    { role: 'required', when: '需要继续完成页面新建流程且已取得模板ID', capabilityId: 'technology-setting-template-version-create-initial', mapping: { templateId: 'result.$', versionNo: 'user.initialVersionNo', versionName: 'user.initialVersionName' }, instruction: '只用同一次新建表单保留的首版字段创建版本；若版本步骤失败，重试版本步骤，不重复创建模板。' },
  ],
  completion: '返回模板族ID；只有首个版本创建并回查成功后，页面新建流程才算完成。',
})

C['technology-setting-template-prepare-update'] = base('以最新模板列表行作为当前值，只合并页面允许编辑的基本信息字段，并保留编辑前快照。', 'prepare', updateInputs, {
  shape: '{ draft: object, previous: object }',
  fields: updateDraftFields,
  empty: 'current缺少页面消费字段、changes包含锁定/未知字段或必填值非法时抛错；没有详情接口可用空对象补值。',
}, ['把draft展示给用户确认；取消时只丢弃draft，确认时把draft作为完整current提交update。'], {
  steps: [
    { role: 'required', when: '用户确认保存编辑', capabilityId: 'technology-setting-template-update', mapping: { current: 'result.draft', changes: 'literal:null' }, instruction: '把完整draft交给update；不要通过changes重新传锁定的templateCode/projectDomain。' },
    { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃draft，不发送PUT。' },
  ],
  completion: '得到含模板ID和页面字段的更新草稿及旧快照，尚未写入。',
})

C['technology-setting-template-update'] = base('保存一条已有模板族的基本信息编辑；模板编码和项目大类保持当前值。', 'write', updateInputs, voidOutput, ['页面使用PUT /update发送完整基本信息快照；成功或超时后按同一id回查模板列表，逐字段核对templateName/status/remark以及锁定字段。'], {
  steps: [{ role: 'recovery', when: 'PUT成功、超时或响应丢失后核实', capabilityId: 'technology-setting-template-list', mapping: {}, instruction: '按args.current.id或提交前的编码/名称重新分页查询，定位同一模板族并逐字段核对；未核实前不重复覆盖更新。' }],
})

C['technology-setting-template-remove'] = base('删除当前模板列表中用户确认的一条模板族。', 'write', { id: idInput }, voidOutput, ['页面删除只发送模板族id；Portal提示已有版本时不能删除。成功或超时后重新查询并确认目标id不再出现；后端拒绝时原样报告。'], {
  steps: [{ role: 'recovery', when: 'DELETE成功、超时或响应丢失后核实', capabilityId: 'technology-setting-template-list', mapping: {}, instruction: '按删除前保留的id、编码和名称分页查询，确认同一id已消失；不能只看成功文案或空回执。' }],
})

C['technology-setting-template-version-list'] = base('读取指定模板族的版本列表，供版本管理、配置模板、复制、发布和停用消费。', 'read', { templateId: { ...idInput, meaning: '模板族主键；版本列表的所属模板。', source: 'technology-setting-template-list.list[].id或当前版本抽屉模板.id。' } }, {
  shape: '{ list: object[], total: integer }',
  fields: versionRowFields,
  empty: 'list=[]且total=0表示该模板族没有版本；list长度小于total表示页面固定500条请求未取全，不能据此认定只有这些版本。权限、网络或响应错误抛出。',
}, ['展示版本号、名称、状态和发布时间；draft才能配置/发布，published才能停用，published/disabled可复制。', '页面固定pageNo=1、pageSize=500，不提供版本分页控件；若total>list.length，不得在仅有部分列表时自动选择唯一草稿。'], {
  steps: [
    { role: 'optional', when: '用户要新建全新版本', capabilityId: 'technology-setting-template-version-prepare-create', mapping: { templateId: 'args.templateId', sourceVersionId: 'literal:null', versionNo: 'user.versionNo', versionName: 'user.versionName', remark: 'user.remark' }, instruction: '新建版本必须把sourceVersionId设为null，随后调用create而不是copy。' },
    { role: 'optional', when: '用户要复制当前列表选定版本', capabilityId: 'technology-setting-template-version-prepare-copy', mapping: { templateId: 'args.templateId', sourceVersionId: 'result.list[].id', versionNo: 'user.versionNo', versionName: 'user.versionName', remark: 'user.remark' }, instruction: '只把选中的同一版本id作为sourceVersionId；不要把模板族id当版本id。' },
  ],
  completion: '已取得指定模板族的版本页及total；没有改变版本状态。',
})

C['technology-setting-template-version-config-get'] = base('读取版本编辑器展示和继续编辑所需的版本配置。', 'read', { versionId: versionConfigIdInput }, {
  shape: 'object',
  fields: versionConfigFields,
  empty: '必须返回包含versionStatus、editable和nodes的配置对象；空对象、坏节点或坏配置项会抛错，不返回默认空配置。',
}, [
  '用versionStatus和editable判断是否可以保存/发布；用templateName、projectDomain、versionNo、versionName和updateTime展示编辑器头部。',
  '用nodes[].sourceNodeId和nodes[].items[].templateItemId关联模板节点树及配置项库；nodes[].children和节点/配置项展示扩展字段只用于编辑器呈现。',
], {
  steps: [
    { role: 'required', when: '需要初始化编辑器左侧节点树', sdkPath: 'technologySettingTemplateBase.nodeList', mapping: { projectDomain: 'result.projectDomain' }, instruction: '按配置返回的projectDomain读取同一项目大类的节点树；不能用默认biology替代已返回的大类。' },
    { role: 'required', when: '需要初始化编辑器配置项候选', sdkPath: 'technologySettingTemplateBase.itemSimpleList', mapping: { projectDomain: 'result.projectDomain', status: 'literal:0' }, instruction: '只加载同一项目大类且启用的字段/业务组件候选；候选ID来自返回项.id。' },
  ],
  completion: '已取得编辑器版本元数据和当前节点配置；此读取不改变服务端。',
})

C['technology-setting-template-version-config-prepare-save'] = base('按编辑器当前节点、配置项顺序和显示字段准备版本配置保存草稿，不发送PUT。', 'prepare', versionConfigSaveInputs, {
  shape: '{ draft: object }',
  fields: versionConfigSaveDraftFields,
  empty: '版本ID、节点ID、父节点ID、排序值、配置项ID或配置项字段非法时抛错且不发送请求；编辑器展示字段不会进入draft。',
}, [
  '节点数组按编辑器当前选择顺序提供；根节点parentSourceNodeId必须为null。',
  '每个配置项只提交templateItemId、displayName、isRequired、sort；displayName允许空字符串，isRequired必须是布尔值。',
], {
  steps: [
    { role: 'required', when: '用户确认保存草稿或准备发布', capabilityId: 'technology-setting-template-version-config-save', mapping: { templateVersionId: 'result.draft.templateVersionId', nodes: 'result.draft.nodes' }, instruction: '把同一draft交给saveVersionConfig；不要把nodes.children、nodeName、itemType等编辑器展示字段补回请求体。' },
    { role: 'cancel', when: '用户在编辑器保存前取消', instruction: '丢弃本地draft，不调用配置保存或发布能力。' },
  ],
  completion: '得到严格匹配Portal PUT body的本地配置草稿，尚未修改服务端。',
})

C['technology-setting-template-version-config-save'] = base('保存模板版本编辑器中的节点选择、配置项显示名称、必填状态和顺序。', 'write', versionConfigSaveInputs, {
  shape: 'object',
  fields: versionConfigFields,
  empty: '必须返回更新后的版本配置对象；请求失败或响应缺少versionStatus、editable、nodes时抛错，不能把PUT成功回执当作已保存配置。',
}, [
  '保存成功后消费返回配置刷新头部状态、更新时间和当前节点；返回的nodes是服务端最终配置，不要继续使用提交前本地数组冒充结果。',
], {
  steps: [
    { role: 'recovery', when: 'PUT成功、超时或响应丢失后核实配置', capabilityId: 'technology-setting-template-version-config-get', mapping: { versionId: 'args.templateVersionId' }, instruction: '用同一模板版本ID重新读取，逐节点核对sourceNodeId/parentSourceNodeId/sort和逐项displayName/isRequired/sort；未核实前不重复保存。' },
    { role: 'optional', when: '用户随后确认发布且读取配置仍为draft', capabilityId: 'technology-setting-template-version-publish', mapping: { id: 'args.templateVersionId', currentStatus: 'literal:"draft"' }, instruction: 'Portal发布会先保存当前配置；只有本次保存成功并回查确认后才能调用发布，发布自身不携带nodes。' },
  ],
  completion: '返回服务端更新后的版本配置；只有配置回查成功且随后发布回查为published，编辑器发布流程才算完成。',
})

C['technology-setting-template-version-prepare-initial'] = base('准备已经创建的模板族的首个版本请求，不发送POST。', 'prepare', initialVersionInputs, {
  shape: '{ draft: object }',
  fields: initialVersionDraftFields,
  empty: '模板ID、版本号或版本名称不合规则时抛错且不发送请求。',
}, ['该能力只用于模板create返回ID之后；用户取消时丢弃draft。'], {
  steps: [
    { role: 'required', when: '用户确认创建首个版本', capabilityId: 'technology-setting-template-version-create-initial', mapping: { templateId: 'result.draft.templateId', versionNo: 'result.draft.versionNo', versionName: 'result.draft.versionName' }, instruction: '把prepare结果原样交给createInitialVersion；不增加sourceVersionId或remark。' },
    { role: 'cancel', when: '用户取消首个版本创建', instruction: '丢弃draft，不发送POST。模板基本信息可能已经创建，调用方需保留模板ID并稍后继续。' },
  ],
})

C['technology-setting-template-version-create-initial'] = base('为已创建的模板族创建首个版本；请求体只有模板ID、版本号和版本名称。', 'write', initialVersionInputs, idOutput, ['页面新建模板流程的第二个独立POST；请求成功后按templateId重新读取版本列表，核对唯一首个版本的versionNo/versionName。'], {
  steps: [{ role: 'recovery', when: '首个版本POST成功、超时或响应丢失后核实', capabilityId: 'technology-setting-template-version-list', mapping: { templateId: 'args.templateId' }, instruction: '回查同一模板族版本列表，按版本号和名称定位；无法唯一定位时不盲目重试。' }],
})

C['technology-setting-template-version-prepare-create'] = base('准备一个不复制已有版本的全新草稿版本，不发送POST。', 'prepare', versionInputs, {
  shape: '{ draft: object }',
  fields: versionDraftFields,
  empty: '模板ID、版本号或版本名称非法时抛错；sourceVersionId必须是null才表示全新创建。',
}, ['展示draft供用户确认；取消时不调用createVersion。'], {
  steps: [
    { role: 'required', when: '用户确认新建草稿版本', capabilityId: 'technology-setting-template-version-create', mapping: { templateId: 'result.draft.templateId', sourceVersionId: 'result.draft.sourceVersionId', versionNo: 'result.draft.versionNo', versionName: 'result.draft.versionName', remark: 'result.draft.remark' }, instruction: '把同一draft交给createVersion；sourceVersionId保持null。' },
    { role: 'cancel', when: '用户取消新建版本', instruction: '丢弃draft，不发送POST。' },
  ],
})

C['technology-setting-template-version-create'] = base('创建一个不复制已有版本的草稿版本。', 'write', versionInputs, idOutput, ['请求体包含sourceVersionId:null和remark；成功或超时后按templateId回查版本列表，确认新版本是draft且字段一致。'], {
  steps: [{ role: 'recovery', when: '版本POST成功、超时或响应丢失后核实', capabilityId: 'technology-setting-template-version-list', mapping: { templateId: 'args.templateId' }, instruction: '回查同一模板族并按版本号/名称定位；匹配不唯一时报告不确定，不重复创建。' }],
})

C['technology-setting-template-version-prepare-copy'] = base('准备把当前版本复制为新的草稿版本，不发送POST。', 'prepare', versionInputs, {
  shape: '{ draft: object }',
  fields: versionDraftFields,
  empty: '模板ID、来源版本ID、版本号或版本名称非法时抛错；复制不能省略sourceVersionId。',
}, ['sourceVersionId必须来自当前版本列表行.id；页面默认版本名称追加“（副本）”，但调用方可以在提交前明确修改。'], {
  steps: [
    { role: 'required', when: '用户确认复制草稿版本', capabilityId: 'technology-setting-template-version-copy', mapping: { templateId: 'result.draft.templateId', sourceVersionId: 'result.draft.sourceVersionId', versionNo: 'result.draft.versionNo', versionName: 'result.draft.versionName', remark: 'result.draft.remark' }, instruction: '把同一draft交给copyVersion；不要改用createVersion，否则不会表达复制来源。' },
    { role: 'cancel', when: '用户取消复制', instruction: '丢弃draft，不发送POST。' },
  ],
})

C['technology-setting-template-version-copy'] = base('把一个已有模板版本复制为新的草稿版本。', 'write', versionInputs, idOutput, ['页面复制请求使用copy端点并发送sourceVersionId；成功或超时后按templateId回查新草稿，核对来源之外的版本字段。'], {
  steps: [{ role: 'recovery', when: '复制POST成功、超时或响应丢失后核实', capabilityId: 'technology-setting-template-version-list', mapping: { templateId: 'args.templateId' }, instruction: '回查同一模板族，按新版本号/名称和draft状态定位；无法唯一定位时不盲目再次复制。' }],
})

C['technology-setting-template-version-publish'] = base('发布当前列表中处于draft状态的模板版本。', 'write', actionInputs, voidOutput, ['页面只有draft版本显示发布按钮；请求只发送版本id作为query参数，data为null。成功或超时后回查版本列表确认versionStatus=published。'], {
  steps: [{ role: 'recovery', when: '发布POST成功、超时或响应丢失后核实', capabilityId: 'technology-setting-template-version-list', mapping: {}, instruction: '使用当前版本抽屉保留的模板族ID回查同一版本；确认状态为published后才报告发布完成。' }],
})

C['technology-setting-template-version-disable'] = base('停用当前列表中处于published状态的模板版本。', 'write', actionInputs, voidOutput, ['页面只有published版本显示停用按钮；请求只发送版本id作为query参数，data为null。成功或超时后回查版本列表确认versionStatus=disabled。'], {
  steps: [{ role: 'recovery', when: '停用PUT成功、超时或响应丢失后核实', capabilityId: 'technology-setting-template-version-list', mapping: {}, instruction: '使用当前版本抽屉保留的模板族ID回查同一版本；确认状态为disabled后才报告停用完成。' }],
})

for (const id of Object.keys(contracts)) if (!definitions.has(id)) throw new Error(`模板中心契约没有对应能力定义：${id}`)

export const TECHNOLOGY_SETTING_TEMPLATE_AI_CONTRACTS: Record<string, AiContract> = contracts
export const TECHNOLOGY_SETTING_TEMPLATE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(TECHNOLOGY_SETTING_TEMPLATE_METHODS).map(([id, method]) => [
    `technologySettingTemplate.${method}`,
    {
      ...contracts[id]!,
      boundaries: [
        ...contracts[id]!.boundaries,
        method === 'remove'
          ? '直接方法签名为technologySettingTemplate.remove(id)；用户确认由调用方负责，成功或不确定仍须按契约回查。'
          : '直接方法签名使用一个参数对象（list可省略对象）；写操作仍须按prepare→submit→回查，取消只发生在本地准备阶段。',
      ],
    },
  ]),
)
