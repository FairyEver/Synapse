import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import {
  TECHNOLOGY_SETTING_TEMPLATE_BASE_DOMAINS,
  TECHNOLOGY_SETTING_TEMPLATE_BASE_ITEM_TYPES,
  TECHNOLOGY_SETTING_TEMPLATE_BASE_METHODS,
  TECHNOLOGY_SETTING_TEMPLATE_BASE_STATUSES,
  technologySettingTemplateBaseCapabilities,
} from '../capabilities/technology-setting-template-base.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path,
  type,
  meaning,
  optional: false,
  nullable: false,
  ...extra,
})
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })

const domains = [
  { value: 'biology', label: '生物' },
  { value: 'information', label: '信息' },
  { value: 'engineering', label: '工程' },
]
const itemTypes = [
  { value: 'field', label: '字段' },
  { value: 'component', label: '业务组件' },
]
const statuses = [
  { value: 0, label: '启用' },
  { value: 1, label: '停用' },
]
const idRules = ['保留Portal返回的安全正整数或其十进制字符串；不能用编码、名称或树层级替代']

const idInput = input('记录主键；删除、编辑定位使用，不是业务编码', 'item-list.list[].id或node-list[].id，由用户选定当前行', {
  type: 'string | number',
  required: true,
  constraints: idRules,
})
const domainInput = input('项目大类编码；页面显示为生物、信息、工程', '用户从Portal固定三项中选择；节点页签切换时来自当前筛选值', {
  type: 'string',
  required: true,
  options: domains,
})
const statusInput = input('数据库状态；0为启用，1为停用', '用户在新增/编辑表单中选择', {
  type: 'integer',
  required: false,
  options: statuses,
  omitted: '新增默认0；编辑省略时保留current.status',
})
const itemTypeInput = input('配置项类型；field表示字段，component表示业务组件', '用户在配置项表单中选择', {
  type: 'string',
  required: true,
  options: itemTypes,
})
const itemCodeInput = input('配置项编码；编辑时控件禁用', '用户新增时填写；编辑时来自配置项列表行itemCode', {
  type: 'string',
  required: true,
  constraints: ['不得为空或全为空格；Portal没有声明长度或格式规则，SDK不擅自增加'],
})
const itemNameInput = input('配置项名称', '用户在配置项新增/编辑表单填写', {
  type: 'string',
  required: true,
  constraints: ['不得为空或全为空格'],
})
const nodeCodeInput = input('模板节点编码；编辑时控件禁用', '用户新增时填写；编辑时来自节点树行nodeCode', {
  type: 'string',
  required: true,
  constraints: ['不得为空或全为空格；Portal没有声明长度或格式规则，SDK不擅自增加'],
})
const nodeNameInput = input('模板节点名称', '用户在节点新增/编辑表单填写', {
  type: 'string',
  required: true,
  constraints: ['不得为空或全为空格'],
})

function itemRowFields(prefix: string): AiField[] {
  const at = (name: string) => prefix + '.' + name
  return [
    field(at('id'), 'string | number', '配置项记录主键；编辑和删除使用', { constraints: idRules }),
    field(at('itemCode'), 'string', '配置项编码；编辑时页面禁用'),
    field(at('itemName'), 'string', '配置项名称'),
    field(at('itemType'), 'string', '配置项类型；field显示字段，其它已返回值按Portal逻辑显示业务组件', { values: { field: '字段', component: '业务组件' }, constraints: ['读取时保留后端未知字符串；写入只接受field或component'] }),
    field(at('projectDomainCodes'), 'string', '适用项目大类编码，多个值以逗号分隔；配置项表格按逗号拆分后映射中文标签', { constraints: ['不能把该字段当作单一projectDomain；写入前SDK按代码排序'] }),
    field(at('mustSelect'), 'boolean', '发布时是否必选；true显示发布必选，false显示普通'),
    field(at('status'), 'number', '状态；页面只把数值0显示为启用，其它值显示停用', { values: { '0': '启用', '1': '停用' }, constraints: ['写入表单只接受数值0或1；读取未知数值原样保留，不声称等于1'] }),
    field(at('remark'), 'string', '备注原文；新增默认空字符串', { nullable: true, nullMeaning: '后端返回null，编辑回填该空值' }),
    field(at('updateTime'), 'string | number', '更新时间原值；页面直接显示，不做时区转换', { nullable: true, nullMeaning: '后端未返回更新时间' }),
  ]
}

function itemSaveFields(prefix: string, includeId: boolean): AiField[] {
  const at = (name: string) => prefix + '.' + name
  return [
    ...(includeId ? [field(at('id'), 'string | number', '同一配置项记录主键', { constraints: idRules })] : [field(at('id'), 'null', '新增请求显式发送null', { nullable: true })]),
    field(at('itemCode'), 'string', '配置项编码；编辑草稿沿用current，不可由changes改写'),
    field(at('itemName'), 'string', '配置项名称'),
    field(at('itemType'), 'string', '配置项类型编码'),
    field(at('projectDomainCodes'), 'string', '排序后的逗号分隔项目大类编码'),
    field(at('mustSelect'), 'boolean', '发布必选布尔值'),
    field(at('status'), 'number', '数值0或1的状态'),
    field(at('remark'), 'string', '备注原文', { nullable: true, nullMeaning: '没有备注' }),
  ]
}

function nodeFields(prefix: string): AiField[] {
  const at = (name: string) => prefix + '.' + name
  return [
    field(at('id'), 'string | number', '节点记录主键；编辑和删除使用', { constraints: idRules }),
    field(at('nodeCode'), 'string', '节点编码；编辑时页面禁用'),
    field(at('nodeName'), 'string', '节点名称'),
    field(at('projectDomain'), 'string', '节点所属项目大类编码；节点表单编辑时禁用', { values: { biology: '生物', information: '信息', engineering: '工程' } }),
    field(at('parentId'), 'string | number', '父节点主键；根节点由SDK提交为0', { nullable: true, nullMeaning: '响应中没有父节点或为根节点' }),
    field(at('sort'), 'number', '非负排序原值；页面input-number设置min=0', { nullable: true, nullMeaning: '响应没有排序值' }),
    field(at('status'), 'number', '状态；数值0显示启用，其它值显示停用', { values: { '0': '启用', '1': '停用' } }),
    field(at('remark'), 'string', '备注原文', { nullable: true, nullMeaning: '没有备注' }),
    field(at('path'), 'string', '节点路径原值；页面直接展示', { optional: true, nullable: true, nullMeaning: '后端没有返回路径' }),
    field(at('leaf'), 'boolean', '是否末级节点；页面按true显示末级', { optional: true, nullable: true, nullMeaning: '后端没有返回leaf' }),
    field(at('depth'), 'number', '树深度；页面按第N级展示', { optional: true, nullable: true, nullMeaning: '后端没有返回depth' }),
    field(at('children'), 'array', '下级节点；节点编辑时会按Portal原样随行数据提交', { optional: true, nullable: true, nullMeaning: '后端没有返回children' }),
    field(at('children[]'), 'object', '一个递归子节点；字段语义与当前节点相同', { optional: true }),
    field(at('children[].id'), 'string | number', '递归子节点主键', { optional: true, constraints: idRules }),
    field(at('children[].nodeCode'), 'string', '递归子节点编码', { optional: true }),
    field(at('children[].nodeName'), 'string', '递归子节点名称', { optional: true }),
    field(at('children[].children'), 'array', '递归子节点的下一级', { optional: true, nullable: true }),
  ]
}

const itemCreateInputs: Record<string, AiParameter> = {
  itemCode: itemCodeInput,
  itemName: itemNameInput,
  itemType: itemTypeInput,
  domainValues: input('页面多选的项目大类编码数组；提交时转换成projectDomainCodes', '用户在配置项表单选择；至少一个且不能重复', {
    type: 'array',
    required: true,
    constraints: ['至少一项；只能取biology、information、engineering；不能重复'],
  }),
  'domainValues[]': { ...domainInput, source: 'domainValues数组中的一个元素' },
  mustSelect: input('是否发布必选', '用户在配置项表单切换开关', { type: 'boolean', required: false, omitted: '新增默认false' }),
  status: statusInput,
  remark: input('备注原文', '用户填写；页面默认空字符串', { type: 'string', required: false, nullable: true, omitted: '新增默认空字符串', nullMeaning: '不填写备注' }),
}

const itemCurrentInputs: Record<string, AiParameter> = {
  current: input('编辑前的完整配置项列表行；不能只传名称或行号', 'item-list.list[]或prepareItemUpdate.previous', {
    type: 'object',
    required: true,
    constraints: ['必须包含id/itemCode/itemName/itemType/projectDomainCodes/mustSelect/status/remark；itemCode不能由changes改变'],
  }),
  'current.id': idInput,
  'current.itemCode': itemCodeInput,
  'current.itemName': itemNameInput,
  'current.itemType': { ...itemTypeInput, required: true },
  'current.projectDomainCodes': input('当前逗号分隔项目大类编码', 'current.projectDomainCodes', { type: 'string', required: true }),
  'current.mustSelect': { meaning: '当前发布必选值', source: 'current.mustSelect', type: 'boolean', required: true },
  'current.status': { ...statusInput, required: true, source: 'current.status' },
  'current.remark': { meaning: '当前备注', source: 'current.remark', type: 'string', required: true, nullable: true },
  changes: input('本次明确修改的配置项字段', '用户确认的变更对象', {
    type: 'object',
    required: false,
    omitted: '省略表示保留current中的可编辑值',
    constraints: ['只允许itemName/itemType/domainValues/mustSelect/status/remark；额外字段忽略；itemCode和projectDomainCodes不能通过changes改写'],
  }),
  'changes.itemName': { ...itemNameInput, required: false, source: '用户本次修改；省略则保留current.itemName' },
  'changes.itemType': { ...itemTypeInput, required: false, source: '用户本次修改；省略则保留current.itemType' },
  'changes.domainValues': { ...itemCreateInputs.domainValues!, required: false, source: '用户本次修改；省略则保留current.projectDomainCodes对应的值' },
  'changes.domainValues[]': { ...itemCreateInputs['domainValues[]']!, required: false, source: 'changes.domainValues数组中的一个元素' },
  'changes.mustSelect': { ...itemCreateInputs.mustSelect!, required: false, source: '用户本次修改；省略则保留current.mustSelect' },
  'changes.status': { ...statusInput, required: false, source: '用户本次修改；省略则保留current.status' },
  'changes.remark': { ...itemCreateInputs.remark!, required: false, source: '用户本次修改；省略则保留current.remark' },
}

const nodeCreateInputs: Record<string, AiParameter> = {
  nodeCode: nodeCodeInput,
  nodeName: nodeNameInput,
  projectDomain: { ...domainInput, required: false, omitted: '省略时按Portal页面默认biology' },
  parentId: input('父节点主键；空值代表根节点', '用户在树选择器中选择；页面提交时form.parentId || 0', {
    type: 'string | number',
    required: false,
    nullable: true,
    omitted: '新增根节点默认null，发请求时转换为0',
    nullMeaning: '根节点',
    constraints: idRules,
  }),
  sort: input('非负排序原值', '用户在input-number中填写；页面默认0', { type: 'number', required: false, nullable: true, omitted: '新增默认0', nullMeaning: '清空排序', constraints: ['不少于0；Portal只设置min=0，不额外限制整数'] }),
  status: statusInput,
  remark: { ...itemCreateInputs.remark!, source: '用户填写；页面默认空字符串' },
}

const nodeCurrentInputs: Record<string, AiParameter> = {
  current: input('编辑前的完整节点树行；不能只传节点名称', 'node-list[].或prepareNodeUpdate.previous；保留页面行上的children/path/leaf/depth等字段', {
    type: 'object',
    required: true,
    constraints: ['必须包含id/nodeCode/nodeName/projectDomain/parentId/sort/status/remark；nodeCode和projectDomain不能由changes改写'],
  }),
  'current.id': idInput,
  'current.nodeCode': nodeCodeInput,
  'current.nodeName': nodeNameInput,
  'current.projectDomain': { ...domainInput, source: 'current.projectDomain' },
  'current.parentId': { ...nodeCreateInputs.parentId!, source: 'current.parentId', required: true },
  'current.sort': { ...nodeCreateInputs.sort!, source: 'current.sort', required: true },
  'current.status': { ...statusInput, source: 'current.status', required: true },
  'current.remark': { ...nodeCreateInputs.remark!, source: 'current.remark', required: true },
  changes: input('本次明确修改的节点字段', '用户确认的变更对象', {
    type: 'object',
    required: false,
    omitted: '省略表示保留current中的可编辑值',
    constraints: ['只允许nodeName/parentId/sort/status/remark；额外字段忽略；nodeCode和projectDomain不能通过changes改写'],
  }),
  'changes.nodeName': { ...nodeNameInput, required: false, source: '用户本次修改；省略则保留current.nodeName' },
  'changes.parentId': { ...nodeCreateInputs.parentId!, required: false, source: '用户本次修改；省略则保留current.parentId' },
  'changes.sort': { ...nodeCreateInputs.sort!, required: false, source: '用户本次修改；省略则保留current.sort' },
  'changes.status': { ...statusInput, required: false, source: '用户本次修改；省略则保留current.status' },
  'changes.remark': { ...nodeCreateInputs.remark!, required: false, source: '用户本次修改；省略则保留current.remark' },
}

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', '请求正常完成；SDK不伪造后端记录、删除条数或业务成功值')],
  empty: '成功为根undefined；失败抛错。是否真正写入必须通过对应列表或树独立回查。',
}

const evidence: AiContract['evidence'] = [
  { source: 'app/portal/menus/technology.js@acab69acc7:17-40', kind: 'reference', note: '证明模板基础配置当前菜单路径为/dashboard/technology/setting/template-base/list，权限为/dashboard/technology/setting/template-base，且与模板中心、类型模板映射并列。' },
  { source: 'app/portal/views/dashboard/technology/setting/template-base/list.vue@acab69acc7:1-24', kind: 'reference', note: '证明页面是一个wrapper，只有item与node两个tab；query.tab为node时展示节点库，否则展示配置项库。' },
  { source: 'app/portal/views/dashboard/technology/setting/template-item/list.vue@acab69acc7:1-212', kind: 'reference', note: '证明配置项筛选、分页、显示字段、表单默认值、四条校验规则、create/update/delete动作及请求数据映射。' },
  { source: 'app/portal/views/dashboard/technology/setting/template-node/list.vue@acab69acc7:1-175', kind: 'reference', note: '证明节点项目大类筛选、树字段、根节点parentId、表单校验、当前节点禁用、保存spread行对象及删除动作。' },
  { source: 'app/portal/views/dashboard/technology/setting/shared.js@acab69acc7:1-92', kind: 'reference', note: '证明platform HTTP实例、固定项目大类和状态选项、配置项与节点的真实URL、HTTP方法和参数位置。' },
  { source: 'src/capabilities/technology-setting-template-base.ts', kind: 'implementation', note: '锁定SDK请求投影、表单默认值、不可编辑字段、节点扩展字段保留、错误传播和返回校验。' },
  { source: 'test/technology-setting-template-base.test.ts', kind: 'test', note: '离线锁定页面映射、module-type缺省、请求体、删除ID、前端校验和关键映射反证；不等于真实Portal或后端写入验证。' },
  { source: 'CodeReview_Mall_Platform_Java@0f1a55718eb', kind: 'reference', note: '固定Java检出未找到template-item/template-node对应controller、DTO或schema；因此没有把后端未证实字段当作已实测事实。' },
]

const gaps = [
  '未执行浏览器基准、测试环境SDK读冒烟或prepare→submit→cancel真实写闭环；本工作单位按用户约束只做离线实现和测试，真实权限、业务包络及写后回查仍需环境可用时验证。',
  '固定Java检出0f1a55718eb未找到模板配置项/模板节点对应controller、DTO或数据库映射；响应包络、唯一性、引用删除保护、服务端字段约束和实际部署路径无法由后端源码核对。',
  '没有取得403/权限失败的真实回执；菜单permission来自Portal源码，未把它误写成每个按钮独立权限。module-type为technology规则缺失下的源码推导，未做浏览器传输层验证。',
]

const commonBoundaries = [
  '只覆盖当前菜单可达的模板基础配置wrapper及其两个页签：模板配置项库、模板节点库；模板中心和类型模板映射是其它页面，不在本能力范围。',
  '所有请求使用platform HTTP实例，路径已含/admin-api。Portal technology菜单没有module-type匹配规则，因此不发送module-type；不要套用其它模块的范围头。',
  '配置项itemCode、节点nodeCode、节点projectDomain在编辑页为禁用字段；changes中的同名恶意字段会被忽略。节点编辑按Portal的spread提交语义保留children/path/leaf/depth等行扩展字段，SDK不凭空做树环检测或禁用所有后代。',
  '页面没有详情接口、导入导出、发布、预览、版本和独立启停动作。删除前由Portal确认框承担确认，SDK的prepare-remove只准备ID，不宣称事务回滚。',
  '后端错误、HTTP错误、权限错误、网络错误和坏响应都抛出；不把错误转换为空列表，不把HTTP成功伪装成业务写入成功。写入后必须重新查询对应配置项列表或节点树。',
]

function contract(purpose: string, effect: AiContract['effect'], inputs: Record<string, AiParameter>, output: AiContract['output'], consume: string[], steps: AiContract['steps'], extra: Partial<AiContract> = {}): AiContract {
  return {
    purpose,
    whenToUse: '操作门户科技设置下的“模板基础配置”页面；先确认用户指的是配置项库还是节点库，再选择对应能力。',
    effect,
    boundaries: commonBoundaries,
    prerequisites: ['SDK会话已绑定当前用户、租户和会话token；账号具备模板基础配置菜单及后端权限；写操作前已得到用户明确确认。'],
    inputs,
    output,
    consume,
    steps,
    completion: effect === 'read'
      ? '已取得当前请求的页面数据并按字段语义交付；空列表或空树是有效结果，不等于权限或网络成功。'
      : effect === 'prepare'
        ? '只完成本地校验和页面默认值/字段映射，尚未发送写请求。'
        : '请求Promise正常完成；仍须通过对应列表或树回查逐字段确认写入结果。',
    failures: [
      '必填文本、ID、枚举、项目大类、配置项多选、排序、状态或布尔值不符合页面约束：不发业务请求，修正输入后重试。',
      '坏响应、401/403、HTTP错误、网络错误或后端业务错误：原样抛出，不降级为空列表、不伪造保存成功；读请求可在状态恢复后重试。',
      '写请求超时或断网时结果不确定：先按原记录ID或编码回查，再决定后续动作；不要盲目重复新增或删除同名记录。',
    ],
    idempotency: effect === 'write'
      ? 'SDK和页面请求没有requestId或幂等键；重复新增可能重复或被后端拒绝。编辑/删除超时后先回查，不自动重发。'
      : null,
    evidence,
    gaps,
    ...extra,
  }
}

const C: Record<string, AiContract> = {}

C['technology-setting-template-base-item-simple-list'] = contract(
  '按项目大类和状态读取模板版本编辑器可选择的配置项候选。',
  'read',
  {
    projectDomain: { ...domainInput, required: false, nullable: true, omitted: '发送null，不限制项目大类；编辑器正常流程应传配置返回的projectDomain', nullMeaning: '不限制项目大类。' },
    status: { ...statusInput, required: false, omitted: '默认0，只返回启用候选。' },
  },
  {
    shape: 'array',
    fields: [
      field('$', 'array', '配置项候选数组；编辑器直接建立可添加候选。'),
      field('[]', 'object', '一条配置项候选。'),
      field('[].id', 'string | number', '配置项主键；加入版本配置时作为templateItemId。', { constraints: idRules }),
      field('[].itemCode', 'string', '配置项编码；编辑器候选标签展示。'),
      field('[].itemName', 'string', '配置项名称；编辑器候选标签和初始displayName使用。'),
      field('[].itemType', 'string', '配置项类型；field允许切换必填，component保存时isRequired归一为false。', { values: { field: '字段', component: '业务组件' } }),
      field('[].mustSelect', 'boolean', '发布必选标记；编辑器候选标签展示。'),
    ],
    empty: '[]表示该项目大类和状态下没有可添加配置项；坏响应会抛错，不降级为空候选。',
  },
  [
    '模板版本编辑器初始化时使用该数组构造候选；用[].id去重和判断已加入项，不能用itemCode或名称代替主键。',
  ],
  [],
)

C['technology-setting-template-base-item-list'] = contract(
  '按配置项编码、名称、项目大类和类型分页查询模板配置项库。',
  'read',
  {
    pageNo: input('从1开始的页码', '调用方分页状态', { type: 'integer', required: false, omitted: '默认1', constraints: ['正整数'] }),
    pageSize: input('当前页条数', '调用方分页状态；Portal公共分页默认20，选项为10/20/50/100', { type: 'integer', required: false, omitted: '默认20', constraints: ['只能是10、20、50或100'] }),
    code: input('配置项编码筛选文本', '用户输入', { type: 'string', required: false, nullable: true, omitted: '发送null，不限制编码', nullMeaning: '不限制编码' }),
    name: input('配置项名称筛选文本', '用户输入', { type: 'string', required: false, nullable: true, omitted: '发送null，不限制名称', nullMeaning: '不限制名称' }),
    projectDomain: { ...domainInput, required: false, nullable: true, omitted: '发送null，不限制项目大类', nullMeaning: '不限制项目大类' },
    itemType: { ...itemTypeInput, required: false, nullable: true, omitted: '发送null，不限制配置项类型', nullMeaning: '不限制配置项类型' },
  },
  {
    shape: '{ list: array, total: number }',
    fields: [field('$', 'object', '当前筛选页和总数'), field('list', 'array', '当前页配置项'), field('list[]', 'object', '一条配置项列表行'), ...itemRowFields('list[]'), field('total', 'number', '符合当前筛选条件的总记录数')],
    empty: 'list=[]表示当前页无配置项；total=0才表示当前筛选没有记录，超过最后一页的空页不等于全局为空。',
  },
  ['展示itemCode/itemName/itemType/projectDomainCodes/mustSelect/status/updateTime；编辑和删除使用同一行的id。', 'projectDomainCodes是逗号分隔编码，必须按代码消费，不能把biology等编码当成名称。'],
  [
    { role: 'optional', when: '用户选定配置项行并要编辑', capabilityId: 'technology-setting-template-base-item-prepare-update', mapping: { current: 'result.list[]', changes: 'literal:{}' }, instruction: '只传选中的完整行；再把用户明确修改的字段放入changes。' },
    { role: 'optional', when: '用户确认删除配置项', capabilityId: 'technology-setting-template-base-item-prepare-remove', mapping: { id: 'result.list[].id' }, instruction: '保存同一行的itemCode和itemName供删除后回查，不按行号或名称猜ID。' },
  ],
)

C['technology-setting-template-base-item-prepare-create'] = contract(
  '按配置项新增表单规则补齐默认值，并把domainValues规范成可提交的projectDomainCodes。',
  'prepare',
  itemCreateInputs,
  { shape: '{ draft: object }', fields: [field('$', 'object', '新增准备结果'), field('draft', 'object', '可传给itemCreate的新增请求草稿'), ...itemSaveFields('draft', false)], empty: '合法输入返回draft；校验失败抛错。' },
  ['确认draft.itemCode/itemName/itemType和projectDomainCodes后再写入；domainValues的数组顺序不会改变提交字符串的排序结果。'],
  [{ role: 'required', when: '用户确认新增且草稿已检查', capabilityId: 'technology-setting-template-base-item-create', mapping: {
    itemCode: 'result.draft.itemCode',
    itemName: 'result.draft.itemName',
    itemType: 'result.draft.itemType',
    domainValues: 'result.draft.projectDomainCodes',
    mustSelect: 'result.draft.mustSelect',
    status: 'result.draft.status',
    remark: 'result.draft.remark',
  }, instruction: '调用itemCreate时可直接传整个draft；若按表单参数传入，先把逗号字符串拆回domainValues数组，不要把字符串作为单一项目大类。' }],
)

C['technology-setting-template-base-item-create'] = contract(
  '向模板配置项create接口提交新增配置项。',
  'write',
  itemCreateInputs,
  voidOutput,
  ['成功后用itemList按itemCode和itemName逐页回查，核对类型、项目大类字符串、必选标记、状态和备注；不能只凭HTTP成功报告已落库。'],
  [{ role: 'required', when: '用户确认新增表单且输入已通过页面规则', capabilityId: 'technology-setting-template-base-item-list', mapping: { code: 'args.itemCode', name: 'args.itemName' }, instruction: '按编码和名称回查；若0条、多条或字段不一致，报告未能独立证实，不自动重复create。' }],
)

C['technology-setting-template-base-item-prepare-update'] = contract(
  '以最新配置项列表行为current，只合并页面允许编辑的字段并保留previous快照。',
  'prepare',
  itemCurrentInputs,
  { shape: '{ draft: object, previous: object }', fields: [field('$', 'object', '编辑准备结果'), field('draft', 'object', '合并后的配置项PUT草稿'), ...itemSaveFields('draft', true), field('previous', 'object', '准备时页面字段快照，不是服务端历史版本'), ...itemSaveFields('previous', true)], empty: 'current缺必需字段或changes非法时抛错；没有详情接口时不返回空草稿。' },
  ['检查draft.id与previous.id相同；itemCode不随changes变化，projectDomainCodes只有在changes.domainValues明确提供时才改变。'],
  [
    { role: 'required', when: '用户确认保存此次编辑', capabilityId: 'technology-setting-template-base-item-update', mapping: { current: 'result.draft', changes: 'literal:{}' }, instruction: '把完整draft作为current或直接传prepare结果；update会再次校验并PUT完整页面字段。' },
    { role: 'cancel', when: '用户确认恢复到本次编辑前值且没有要保留的并发修改', capabilityId: 'technology-setting-template-base-item-update', mapping: {
      current: 'result.draft',
      'changes.itemName': 'result.previous.itemName',
      'changes.itemType': 'result.previous.itemType',
      'changes.domainValues': 'result.previous.projectDomainCodes',
      'changes.mustSelect': 'result.previous.mustSelect',
      'changes.status': 'result.previous.status',
      'changes.remark': 'result.previous.remark',
    }, instruction: '恢复是再次PUT，不是服务端事务回滚；projectDomainCodes需先拆成domainValues数组，完成后仍须itemList回查。' },
  ],
)

C['technology-setting-template-base-item-update'] = contract(
  '向模板配置项update接口提交配置项编辑结果。',
  'write',
  itemCurrentInputs,
  voidOutput,
  ['成功或超时后用itemList按原id回查；核对itemCode未被改变以及所有可编辑字段。'],
  [{ role: 'required', when: '用户确认更新并已有current或prepare结果', capabilityId: 'technology-setting-template-base-item-list', mapping: { code: 'args.current.itemCode', name: 'args.current.itemName' }, instruction: '回查同一配置项ID；不要以同名其它记录代替，也不要把PUT响应包络当作最终状态。' }],
)

C['technology-setting-template-base-item-prepare-remove'] = contract(
  '准备配置项删除确认，只校验并保留要删除的记录ID。',
  'prepare',
  { id: idInput },
  { shape: '{ id: string | number }', fields: [field('$', 'object', '删除准备结果'), field('id', 'string | number', '待删除配置项主键', { constraints: idRules })], empty: 'ID不合法时抛错。' },
  ['在真正删除前向用户展示所选配置项编码和名称；不要只展示ID或按名称重新查找其它行。'],
  [{ role: 'required', when: '用户确认删除', capabilityId: 'technology-setting-template-base-item-remove', mapping: { id: 'result.id' }, instruction: '只传prepare返回的id；删除动作没有恢复或撤销接口。' }],
)

C['technology-setting-template-base-item-remove'] = contract(
  '向模板配置项delete接口删除用户确认的配置项记录。',
  'write',
  { id: idInput },
  voidOutput,
  ['成功或超时后用itemList回查原ID不再出现；若仍存在，不自动重复删除。'],
  [{ role: 'required', when: 'DELETE正常完成或超时需要核实', capabilityId: 'technology-setting-template-base-item-list', mapping: { code: 'context.selectedItemCode', name: 'context.selectedItemName' }, instruction: 'context必须来自删除前同一列表行；逐页按id确认，不以空页或名称消失代替ID核对。' }],
)

C['technology-setting-template-base-node-list'] = contract(
  '按项目大类查询模板节点树。',
  'read',
  {
    projectDomain: { ...domainInput, required: false, omitted: '默认biology；节点页签首次加载和重置均使用biology' },
  },
  {
    shape: 'array',
    fields: [field('$', 'array', '当前项目大类的节点树根数组'), field('[]', 'object', '一个根节点'), ...nodeFields('[]')],
    empty: '[]表示当前项目大类没有返回节点；坏响应会抛错，不会转换为空树。',
  },
  ['树表显示nodeName/nodeCode/leaf/depth/sort/status/path；新增子节点使用当前行id作为parentId，根节点parentId提交为0。'],
  [
    { role: 'optional', when: '用户选择新增根节点', capabilityId: 'technology-setting-template-base-node-prepare-create', mapping: { projectDomain: 'args.projectDomain', parentId: 'literal:null' }, instruction: '按当前筛选项目大类准备根节点。' },
    { role: 'optional', when: '用户选择某节点新增子节点', capabilityId: 'technology-setting-template-base-node-prepare-create', mapping: { projectDomain: 'args.projectDomain', parentId: 'result.[].id' }, instruction: 'parentId使用当前树行主键，不使用路径或数组下标。' },
  ],
)

C['technology-setting-template-base-node-prepare-create'] = contract(
  '按节点新增表单规则补齐默认项目大类、根节点父级、排序、状态和备注。',
  'prepare',
  nodeCreateInputs,
  { shape: '{ draft: object }', fields: [field('$', 'object', '节点新增准备结果'), field('draft', 'object', '可传给nodeCreate的请求草稿'), field('draft.id', 'null', '新增请求发送时由SDK补为null', { optional: true, nullable: true }), ...nodeFields('draft').filter(item => item.path !== 'draft.id'),], empty: '合法输入返回draft；nodeCode或nodeName为空等校验失败时抛错。' },
  ['确认projectDomain与parentId归属当前树；空parentId在真正请求中会映射为0。'],
  [{ role: 'required', when: '用户确认新增节点', capabilityId: 'technology-setting-template-base-node-create', mapping: { nodeCode: 'result.draft.nodeCode', nodeName: 'result.draft.nodeName', projectDomain: 'result.draft.projectDomain', parentId: 'result.draft.parentId', sort: 'result.draft.sort', status: 'result.draft.status', remark: 'result.draft.remark' }, instruction: '直接把draft传nodeCreate；不要把页面path、children或数组下标当作parentId。' }],
)

C['technology-setting-template-base-node-create'] = contract(
  '向模板节点create接口提交新增节点。',
  'write',
  nodeCreateInputs,
  voidOutput,
  ['成功后用nodeList按同一projectDomain回查，核对nodeCode、nodeName、parentId和状态；不凭HTTP成功推断树已刷新。'],
  [{ role: 'required', when: '用户确认新增节点且输入通过页面规则', capabilityId: 'technology-setting-template-base-node-list', mapping: { projectDomain: 'args.projectDomain' }, instruction: '回查同一项目大类的树并按nodeCode与nodeName定位；0条或多条时报告未能独立证实，不重复新增。' }],
)

C['technology-setting-template-base-node-prepare-update'] = contract(
  '以最新节点树行作为current，只合并节点编辑页允许修改的字段并保留previous及Portal行扩展字段。',
  'prepare',
  nodeCurrentInputs,
  { shape: '{ draft: object, previous: object }', fields: [field('$', 'object', '节点编辑准备结果'), field('draft', 'object', '完整PUT草稿；保留页面spread的children/path/leaf/depth等字段'), ...nodeFields('draft'), field('previous', 'object', '准备时节点行快照，不是服务端历史版本'), ...nodeFields('previous')], empty: 'current缺字段或changes非法时抛错；不能用节点名称猜测current。' },
  ['检查draft.id、nodeCode、projectDomain与previous一致；changes只能影响nodeName/parentId/sort/status/remark。'],
  [
    { role: 'required', when: '用户确认保存节点编辑', capabilityId: 'technology-setting-template-base-node-update', mapping: { current: 'result.draft', changes: 'literal:{}' }, instruction: '把完整draft作为current传入；SDK保留页面行扩展字段并PUT。' },
    { role: 'cancel', when: '用户确认恢复到编辑前节点值且没有并发修改', capabilityId: 'technology-setting-template-base-node-update', mapping: { current: 'result.draft', 'changes.nodeName': 'result.previous.nodeName', 'changes.parentId': 'result.previous.parentId', 'changes.sort': 'result.previous.sort', 'changes.status': 'result.previous.status', 'changes.remark': 'result.previous.remark' }, instruction: '恢复是再次PUT，不是服务端回滚；nodeCode和projectDomain从current保留。' },
  ],
)

C['technology-setting-template-base-node-update'] = contract(
  '向模板节点update接口提交节点编辑结果。',
  'write',
  nodeCurrentInputs,
  voidOutput,
  ['成功或超时后用nodeList按同一projectDomain回查原节点ID及其父级；核对不可编辑字段和允许修改字段。'],
  [{ role: 'required', when: '用户确认更新节点或超时需要核实', capabilityId: 'technology-setting-template-base-node-list', mapping: { projectDomain: 'args.current.projectDomain' }, instruction: '回查同一项目大类树并按ID定位；不要按nodeName或path替代ID。' }],
)

C['technology-setting-template-base-node-prepare-remove'] = contract(
  '准备节点删除确认，只校验并保留要删除的节点ID。',
  'prepare',
  { id: idInput },
  { shape: '{ id: string | number }', fields: [field('$', 'object', '删除准备结果'), field('id', 'string | number', '待删除节点主键', { constraints: idRules })], empty: 'ID不合法时抛错。' },
  ['删除前保留nodeCode/nodeName/projectDomain用于确认和回查；SDK不提前假定后端是否允许删除有子节点的节点。'],
  [{ role: 'required', when: '用户确认删除节点', capabilityId: 'technology-setting-template-base-node-remove', mapping: { id: 'result.id' }, instruction: '只传prepare返回的id；删除没有取消或恢复接口。' }],
)

C['technology-setting-template-base-node-remove'] = contract(
  '向模板节点delete接口删除用户确认的节点。',
  'write',
  { id: idInput },
  voidOutput,
  ['成功或超时后用nodeList按删除前projectDomain回查原ID不再出现；后端若因子节点引用拒绝，原样报告。'],
  [{ role: 'required', when: 'DELETE正常完成或超时需要核实', capabilityId: 'technology-setting-template-base-node-list', mapping: { projectDomain: 'context.selectedNodeProjectDomain' }, instruction: 'context必须来自删除前同一树行；按ID核对，不用空树或名称消失替代。' }],
)

export const TECHNOLOGY_SETTING_TEMPLATE_BASE_CONTRACTS: Record<string, AiContract> = C

export const TECHNOLOGY_SETTING_TEMPLATE_BASE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(TECHNOLOGY_SETTING_TEMPLATE_BASE_METHODS).map(([capabilityId, method]) => {
    const source = C[capabilityId]!
    const signature = method.endsWith('Remove')
      ? '公开方法technologySettingTemplateBase.' + method + '(id)接收一个记录ID；能力invoke接收{id}对象。'
      : '公开方法technologySettingTemplateBase.' + method + '(input)接收单个对象参数；字段与inputs一致。'
    return ['technologySettingTemplateBase.' + method, { ...source, boundaries: [...source.boundaries, signature] }]
  }),
)

if (
  domains.map(item => item.value).join(',') !== TECHNOLOGY_SETTING_TEMPLATE_BASE_DOMAINS.join(',')
  || itemTypes.map(item => item.value).join(',') !== TECHNOLOGY_SETTING_TEMPLATE_BASE_ITEM_TYPES.join(',')
  || statuses.map(item => item.value).join(',') !== TECHNOLOGY_SETTING_TEMPLATE_BASE_STATUSES.join(',')
  || technologySettingTemplateBaseCapabilities.map(item => item.id).join(',') !== Object.keys(TECHNOLOGY_SETTING_TEMPLATE_BASE_METHODS).join(',')
) {
  throw new Error('模板基础配置AI契约枚举、动作或执行定义不一致')
}
