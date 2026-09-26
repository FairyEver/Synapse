import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALE_SYS_DICT_METHODS } from '../capabilities/sale-sys-dict.js'

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })

const pagePath = '/dashboard/sale/sys/dict/list'
const pagePermission = '/dashboard/sale/frame/sys/dict'
const actionPermission = 'sys:dict:edit'

const rowFields: AiField[] = [
  field('list[].id', 'string | number | null', '字典记录ID；编辑和删除时使用，保留字符串避免长整数精度损失', { nullable: true, nullMeaning: '没有ID不能可靠编辑或删除' }),
  field('list[].value', 'string | null', '字典值；弹窗“键值”字段', { nullable: true }),
  field('list[].label', 'string | null', '字典标签；弹窗“标签”字段，也可点击进入编辑', { nullable: true }),
  field('list[].type', 'string | null', '字典类型；筛选项和弹窗“类型”字段', { nullable: true }),
  field('list[].description', 'string | null', '字典描述；筛选项和弹窗“描述”字段', { nullable: true }),
  field('list[].sort', 'number | null', '显示排序；弹窗输入框默认新建值为10，新增键值会先读取该类型最大值再加10', { nullable: true }),
  field('list[].parentId', 'string | null', '旧字典记录的父ID；页面编辑时会随当前行原样带回', { nullable: true }),
  field('list[].brandId', 'number | null', '商城品牌来源标记；brandId=0且itemId=0时页面显示编辑/删除/添加键值动作', { nullable: true }),
  field('list[].itemId', 'number | null', '商城商品来源标记；与brandId共同决定页面是否允许编辑动作', { nullable: true }),
  field('list[].remarks', 'string | null', '备注；弹窗字段名是remarks', { nullable: true }),
  field('list[].createDate', 'string | number | null', '创建时间原值；编辑时Portal会从提交对象中删除', { nullable: true }),
  field('list[].updateDate', 'string | number | null', '更新时间原值；编辑时Portal会从提交对象中删除', { nullable: true }),
]

const listOutput: AiContract['output'] = {
  shape: '{ list: object[], total: number }',
  fields: [
    field('$', 'object', 'CRM旧字典接口分页结果；响应count映射为total'),
    field('list', 'object[]', '当前页字典记录，不是全量数据'),
    field('total', 'number', '符合筛选条件的记录总数，用于分页，不是当前页长度'),
    ...rowFields,
  ],
  empty: 'list=[]且total=0表示当前筛选没有字典记录；权限、租户或响应形状错误会抛错。',
}

const typeListOutput: AiContract['output'] = {
  shape: 'string[]',
  fields: [field('$', 'string[]', 'Portal把每个类型映射成下拉选项label/value；不要把标签当记录ID')],
  empty: '空数组表示当前租户没有可用字典类型选项。',
}

const maxSortOutput: AiContract['output'] = {
  shape: 'number | null',
  fields: [field('$', 'number | null', '当前type的最大排序值；Portal新增键值时将非空结果加10，null时保留弹窗默认10', { nullable: true, nullMeaning: '当前类型没有可用最大排序值，继续使用10' })],
  empty: 'type为空或后端返回null时，不能把null解释成已存在的排序值。',
}

const formFields: AiField[] = [
  field('form', 'object', 'Portal ModalFormContent的完整表单；编辑会把当前行去掉createDate/updateDate后作为原始值展开，SDK保留其它原始扩展字段'),
  field('form.value', 'string', '字典值；页面没有required规则，但CRM后端实体要求有效值，提交空值可能被拒绝'),
  field('form.label', 'string', '字典标签；页面没有required规则，但CRM后端实体要求有效值，提交空值可能被拒绝'),
  field('form.type', 'string', '字典类型；新增键值应使用当前列表行的type，页面没有required规则但后端有长度约束'),
  field('form.description', 'string', '字典描述；可为空'),
  field('form.sort', 'number | null', '排序；新建弹窗默认10，输入控件下限为0；清空后可能向后端提交null', { nullable: true }),
  field('form.remarks', 'string', '备注；可为空'),
  field('form.id', 'string | number', '编辑时当前行ID；新建时通常省略', { optional: true, nullable: true, nullMeaning: '新建不带ID；编辑缺少ID会在SDK准备阶段拒绝' }),
]

const formOutput: AiContract['output'] = {
  shape: '{ draft: object }',
  fields: [{ ...formFields[0]!, path: 'draft' }, ...formFields.slice(1).map(item => ({ ...item, path: item.path.replace(/^form/, 'draft') }))],
  empty: '表单结构或编辑ID不合法时准备阶段抛错，不发送POST；准备成功不等于后端保存成功。',
}

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', 'CRM保存或删除成功回执没有业务数据；不要把保存成功文案当成新ID')],
  empty: 'Promise完成只代表请求成功；写入结果必须通过列表回查核实。',
}

const formInputs: Record<string, AiParameter> = {
  form: param('Portal字典配置弹窗的完整表单。', '用户输入；编辑时先取当前列表行并移除createDate/updateDate', {
    type: 'object',
    required: true,
    constraints: [
      '页面value、label、type规则均为required=false，description、sort、remarks没有必填规则；不要在SDK中把页面可提交的空值静默改成其它业务值。',
      'sort默认10且页面输入下限为0；新增键值前先用当前行type调用sale-sys-dict-max-sort，非空结果加10。',
      '编辑必须保留当前行id和页面允许的原始字段；创建不应凭空带已有记录ID。',
    ],
  }),
}

const draftInputs: Record<string, AiParameter> = {
  draft: param('prepareCreate/prepareUpdate返回的同一份字典配置草稿。', '上一步prepare结果；提交前必须取得用户明确确认', { type: 'object', required: true }),
  'draft.type': param('草稿中的字典类型；用于保存后按类型回查。', 'sale-sys-dict-prepare-create/prepare-update.draft.type', { type: 'string', required: true }),
  'draft.label': param('草稿中的字典标签；用于保存后辅助定位。', 'sale-sys-dict-prepare-create/prepare-update.draft.label', { type: 'string', required: false }),
}
const idInput = param('当前列表记录ID。', 'sale-sys-dict-list.list[].id，由用户选择一条当前可见记录', { type: 'string | number', required: true, constraints: ['必须是非空字符串或正整数；不能用label、type或value代替。'] })

const gaps = [
  '尚未在真实测试环境执行本页类型选项、分页、最大排序、创建、编辑、删除及写后列表回查；当前证据来自Portal页面、固定Java Controller/Entity/Mapper和离线请求断言。',
]

function base (purpose: string, output: AiContract['output'], consume: string[], effect: AiContract['effect'] = 'read'): AiContract {
  return {
    purpose,
    whenToUse: purpose,
    boundaries: [
      `只覆盖门户销售系统菜单下的“字典配置”页面${pagePath}；它不是同名的“配置数据”页面，也不是平台字典页面。`,
      `列表入口受${pagePermission}控制；新建、编辑、删除和弹窗保存按钮都受${actionPermission}控制。SDK不会根据本地权限清单伪造授权，后端拒绝原样抛出。`,
      '页面使用Portal crm.js实例（baseURL取VITE_CRM_API），module-type=60；不能用platform实例或已有sale-setting-dict的/admin-api字典类型接口替代。',
      '列表响应来自CRM旧/vue/sys/dict接口，新增和编辑共用POST /vue/sys/dict/save；编辑不通过独立详情GET，而是把当前列表行作为弹窗原始值。',
      'brandId或itemId非0的商城源数据行只展示来源标签，页面不显示编辑/删除/添加键值动作；调用方必须自己确认当前记录确实是页面可操作行。',
    ],
    effect,
    prerequisites: ['SDK已绑定当前用户、租户会话和crm base URL；写操作的表单或ID必须来自用户明确选择/确认。'],
    inputs: {},
    output,
    consume,
    steps: [],
    completion: effect === 'write' ? 'Promise完成只代表Portal请求成功；保存或删除后必须重新分页查询核对，不把空回执当业务结果。' : effect === 'prepare' ? '得到无副作用的确认草稿；用户取消时不发送业务请求。' : '返回通过结构校验的当前页面数据或选项。',
    failures: ['非法表单、ID、分页值或响应形状在本地失败；权限、租户、网络和后端业务错误原样抛出。', '保存或删除超时后结果不确定，先列表回查再决定是否重试。'],
    idempotency: effect === 'write' ? 'Portal旧接口没有requestId幂等契约；创建/保存/删除超时可能已生效，必须先按记录字段或ID回查，不能盲目重发。' : null,
    evidence: [
      { source: 'CodeReview_Projects_Js@test/portal/main: app/portal/menus/sale.js:215、app/portal/views/dashboard/sale/sys/dict/list.vue、ModalFormContent.vue、common/libs/renren/list.js', kind: 'reference', note: '证明页面路径/权限、crm实例、筛选字段、分页参数、类型选项、最大排序、弹窗字段、action permission和请求链。' },
      { source: 'CodeReview_Mall_Platform_Java@test/test: erp-module-crm/.../DictVueController.java、Dict.java、DictDao.xml、DictService.java', kind: 'reference', note: '证明/vue/sys/dict列表、类型、最大排序、保存、删除路由及CRM实体字段/租户与重复校验；不把新平台字典路由混入。' },
      { source: 'src/capabilities/sale-sys-dict.ts 与 test/sale-sys-dict.test.ts', kind: 'test', note: '锁定页面请求形状、表单默认值/字段保留、权限元数据和prepare确认链；不替代真实环境写操作。' },
      { source: 'docs/pages/字典配置.md', kind: 'reference', note: '记录逐字段基准、请求链、来源数据限制、权限边界和未验证缺口。' },
    ],
    gaps,
  }
}

const contracts: Record<string, AiContract> = {
  'sale-sys-dict-list': {
    ...base('分页查询字典配置，按标签、类型和描述筛选。', listOutput, ['展示当前页value、label、type、description、sort；保留list[].id进行编辑和删除。', 'total只用于翻页；需要全量时继续递增pageNo，不能把当前页当全量。']),
    inputs: {
      order: param('Portal公共列表排序值。', 'useListPageModule公共状态；页面默认空字符串且没有排序控件', { type: 'string', required: false, omitted: 'SDK发送空字符串，不代表页面提供排序交互' }),
      orderField: param('Portal公共列表排序字段。', 'useListPageModule公共状态；页面默认空字符串且没有排序控件', { type: 'string', required: false, omitted: 'SDK发送空字符串，不代表页面提供排序交互' }),
      label: param('字典标签筛选片段。', '用户输入；页面默认空字符串', { type: 'string', required: false, omitted: '空字符串表示不筛选' }),
      type: param('字典类型筛选值。', '用户从sale-sys-dict-type-list得到的选项或明确输入', { type: 'string', required: false, omitted: '空字符串表示不筛选' }),
      description: param('字典描述筛选片段。', '用户输入；页面默认空字符串', { type: 'string', required: false, omitted: '空字符串表示不筛选' }),
      pageNo: param('页码，从1开始。', '调用方分页状态', { type: 'integer', required: false, default: 'SDK默认1' }),
      pageSize: param('每页记录数。', 'Portal列表分页控件', { type: 'integer', required: false, default: 'SDK默认20', constraints: ['接受10/20/50/100/200/500。'] }),
    },
  },
  'sale-sys-dict-type-list': {
    ...base('读取字典配置筛选框所需的CRM字典类型字符串列表。', typeListOutput, ['把每个字符串同时作为下拉label和value；不要把它们当作字典记录ID。']),
  },
  'sale-sys-dict-max-sort': {
    ...base('读取当前字典类型的最大排序值，为“添加键值”弹窗复现Portal默认排序。', maxSortOutput, ['将非空结果加10后填入新键值表单sort；结果为空时使用Portal弹窗默认10。', '这个接口只提供默认值，不代表用户已经确认保存。']),
    inputs: { type: param('当前字典类型。', '用户选中的列表行.type', { type: 'string', required: false, omitted: '空字符串仍按Portal原请求发送；新增键值应优先使用当前行的非空type' }) },
  },
  'sale-sys-dict-prepare-create': {
    ...base('按Portal新建或添加键值弹窗整理字典配置草稿，不发送save。', formOutput, ['新建字典类型时使用空表单默认sort=10；添加键值时先调用maxSort并把结果加10，再把type/description带入表单。', '用户确认后把result.draft原样交给sale-sys-dict-create；取消时只丢弃草稿。'], 'prepare'),
    inputs: formInputs,
    steps: [{ role: 'required', when: '用户明确确认新建或添加键值', capabilityId: 'sale-sys-dict-create', mapping: { draft: 'result.draft' }, instruction: '提交prepare通过的同一份完整草稿；页面创建和编辑都使用同一个save接口。' }, { role: 'cancel', when: '用户取消弹窗', instruction: '只丢弃草稿，不发送POST。' }],
  },
  'sale-sys-dict-create': {
    ...base('保存用户确认的新字典类型或新字典键值。', voidOutput, ['页面成功回执不返回新ID；保存或超时后按type、value、label、description等字段分页回查，匹配不唯一时不能猜测哪条是本次写入。', '重复value/type由CRM后端拒绝，不能把错误当成功。'], 'write'),
    inputs: draftInputs,
    steps: [{ role: 'recovery', when: 'POST成功、超时或响应丢失后核实结果', capabilityId: 'sale-sys-dict-list', mapping: { type: 'args.draft.type', label: 'args.draft.label' }, instruction: '按保存前的字段条件分页查询并逐字段核对；没有唯一匹配就报告不确定，不重复创建。' }],
  },
  'sale-sys-dict-prepare-update': {
    ...base('按Portal当前列表行整理编辑字典配置草稿，不发送save。', formOutput, ['编辑没有独立详情GET；从当前列表行复制原始字段并删除createDate/updateDate，再让用户确认修改。', '用户确认后把result.draft交给sale-sys-dict-update；取消时不发送请求。'], 'prepare'),
    inputs: formInputs,
    steps: [{ role: 'required', when: '用户明确确认编辑当前可操作行', capabilityId: 'sale-sys-dict-update', mapping: { draft: 'result.draft' }, instruction: '提交保留当前行id的完整草稿；不要把页面显示的创建/更新时间字段带入save。' }, { role: 'cancel', when: '用户取消编辑', instruction: '只丢弃草稿，不发送POST。' }],
  },
  'sale-sys-dict-update': {
    ...base('保存用户确认的现有字典配置编辑。', voidOutput, ['页面使用同一POST /vue/sys/dict/save而不是PUT；成功或超时后按draft.id回查当前行终态。'], 'write'),
    inputs: draftInputs,
    steps: [{ role: 'recovery', when: 'POST成功、超时或响应丢失后核实结果', capabilityId: 'sale-sys-dict-list', mapping: { type: 'args.draft.type', label: 'args.draft.label' }, instruction: '分页查询并按同一id核对value、label、type、description、sort、remarks；找不到或字段冲突不能报告已更新。' }],
  },
  'sale-sys-dict-prepare-remove': {
    ...base('准备删除当前列表中用户选定的一条字典配置，不发送DELETE。', { shape: '{ id: string | number }', fields: [field('id', 'string | number', '待删除的当前列表字典记录ID')], empty: 'ID非法时抛错；准备阶段不发送请求。' }, ['展示当前记录label和type等待用户确认；确认后把result.id交给sale-sys-dict-remove，取消时丢弃草稿。'], 'prepare'),
    inputs: { id: idInput },
    steps: [{ role: 'required', when: '用户明确确认删除', capabilityId: 'sale-sys-dict-remove', mapping: { id: 'result.id' }, instruction: '提交同一个当前列表记录ID；成功或超时后分页回查目标ID。' }, { role: 'cancel', when: '用户取消删除', instruction: '丢弃删除草稿，不发送DELETE。' }],
  },
  'sale-sys-dict-remove': {
    ...base('删除当前列表中用户确认的一条字典配置记录。', voidOutput, ['页面只支持单条删除；删除成功或超时后按原筛选条件分页核对目标ID消失，不能只看空回执。'], 'write'),
    inputs: { id: idInput },
    steps: [{ role: 'recovery', when: 'DELETE成功、超时或响应丢失后核实结果', capabilityId: 'sale-sys-dict-list', mapping: {}, instruction: '逐页查询并确认目标ID不再出现；仍出现或权限/业务错误时不要自动重删。' }],
  },
}

export const SALE_SYS_DICT_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(SALE_SYS_DICT_METHODS).map(id => [id, contracts[id]!]))
export const SALE_SYS_DICT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALE_SYS_DICT_METHODS).map(([id, method]) => [`saleSysDict.${method}`, SALE_SYS_DICT_AI_CONTRACTS[id]!]))
