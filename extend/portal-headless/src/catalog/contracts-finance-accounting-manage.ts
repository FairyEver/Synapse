import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { FINANCE_ACCOUNTING_MANAGE_METHODS } from '../capabilities/finance-accounting-manage.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({
  path, type, meaning, optional: false, nullable: false, ...extra,
})
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({
  meaning, source, required: true, ...extra,
})

const statusOptions = [{ value: 0, label: '启用' }, { value: 1, label: '停用' }]
const longTermOptions = [{ value: 0, label: '时间范围' }, { value: 1, label: '长期有效' }]
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不得用名称、编码或其他实体ID代替']

const pageNo = input('从1开始的页码', '调用方分页状态', {
  type: 'integer', required: false, omitted: 'SDK默认1', constraints: ['正整数'],
})
const pageSize = input('当前页请求条数', '调用方分页需要', {
  type: 'integer', required: false, omitted: 'SDK默认20，与PC列表一致',
  constraints: ['账套列表只能取10、20、50、100'],
})
const status = input('账套绝对状态', '用户选择页面状态或最新列表行', {
  type: 'integer', options: statusOptions,
})

const listInputs: Record<string, AiParameter> = {
  corporationId: input('所属法人库ID；不是组织树ID或法人名称', 'finance-accounting-manage-corporation-search.list[].id', {
    type: 'string | number', required: false, nullable: true,
    omitted: 'SDK发送null，platform序列化时不出现在URL，不限制法人', nullMeaning: '不按法人筛选', constraints: idRules,
    lookup: { capabilityId: 'finance-accounting-manage-corporation-search', args: {}, valueField: 'list[].id', labelField: 'list[].name' },
  }),
  accountCode: input('账套编码包含筛选', '用户输入', { type: 'string', required: false, omitted: 'SDK发送空字符串，不限制编码' }),
  accountingName: input('账套名称包含筛选', '用户输入', { type: 'string', required: false, omitted: 'SDK发送空字符串，不限制名称' }),
  accountingStandardsApply: input('会计准则字典数值', 'finance-accounting-manage-accounting-standards-options.list[].value', {
    type: 'integer', required: false, omitted: 'SDK发送空字符串，不限制会计准则',
    lookup: { capabilityId: 'finance-accounting-manage-accounting-standards-options', args: {}, valueField: 'list[].value', labelField: 'list[].label' },
  }),
  periodYear: input('会计期间年度筛选', '用户在年度选择器选择', {
    type: 'string', required: false, format: 'YYYY', omitted: 'SDK发送空字符串，不限制年度', constraints: ['四位年份'],
  }),
  status: { ...status, required: false, source: '用户选择页面状态单选项', omitted: 'SDK默认数值0（启用）' },
  pageNo,
  pageSize,
}

const createInputs: Record<string, AiParameter> = {
  accountingName: input('账套名称', '用户输入', {
    type: 'string', constraints: ['必填且不得全为空格；固定前端没有长度规则，后端冲突由业务错误返回'],
  }),
  accountCode: input('全局唯一的账套编码', '用户输入', {
    type: 'string', format: '4位十进制数字字符串', constraints: ['必须匹配^\\d{4}$；保留前导零；未删除账套间全局唯一'],
  }),
  corporationId: input('所属法人库ID；不是公共组织ID', 'finance-accounting-manage-corporation-search.list[].id中用户选择一项', {
    type: 'string | number', constraints: idRules,
    lookup: { capabilityId: 'finance-accounting-manage-corporation-search', args: {}, valueField: 'list[].id', labelField: 'list[].name' },
  }),
  accountingStandardsApply: input('会计准则字典数值', 'finance-accounting-manage-accounting-standards-options.list[].value中用户选择一项', {
    type: 'integer', lookup: { capabilityId: 'finance-accounting-manage-accounting-standards-options', args: {}, valueField: 'list[].value', labelField: 'list[].label' },
  }),
  isLongTerm: input('账套时效类型', '用户选择时间范围或长期有效', { type: 'integer', options: longTermOptions }),
  startTime: input('账套开始使用日期', '用户在创建页选择', { type: 'string', format: 'YYYY-MM-DD（日期，无时刻）', constraints: ['必须是有效日历日期'] }),
  endTime: input('账套截止使用日期', '时间范围模式由用户选择；长期有效模式不填写', {
    type: 'string', required: false, nullable: true, requiredWhen: 'isLongTerm=0（时间范围）',
    nullMeaning: '长期有效，没有截止日期', omitted: 'isLongTerm=1时SDK发送空字符串，与PC表单一致', format: 'YYYY-MM-DD（日期，无时刻）',
    constraints: ['isLongTerm=0时与startTime同年且不早于startTime', 'isLongTerm=1时必须省略、传null或空字符串'],
  }),
  periodId: input('会计期间主记录ID；不是年度或月度ID', '先以startTime与isLongTerm调用finance-accounting-manage-accounting-period-options，再由用户选择list[].id', {
    type: 'string | number', constraints: idRules,
    lookup: { capabilityId: 'finance-accounting-manage-accounting-period-options', args: {}, valueField: 'list[].id', labelField: 'list[].year' },
  }),
  accuracyId: input('会计精度主记录ID', 'finance-accounting-manage-accuracy-options.list[].id中用户选择一项', {
    type: 'string | number', constraints: idRules,
    lookup: { capabilityId: 'finance-accounting-manage-accuracy-options', args: {}, valueField: 'list[].id', labelField: 'list[].name' },
  }),
  industry: input('行业', '用户输入', { type: 'string', required: false, omitted: 'SDK发送空字符串' }),
  creditCode: input('统一社会信用代码', '用户输入', { type: 'string', required: false, omitted: 'SDK发送空字符串；页面没有额外格式校验' }),
  taxCode: input('税号', '用户输入', { type: 'string', required: false, omitted: 'SDK发送空字符串；页面没有额外格式校验' }),
  businessAddress: input('经营地址', '用户输入', { type: 'string', required: false, omitted: 'SDK发送空字符串' }),
  contacts: input('联系人', '用户输入', { type: 'string', required: false, omitted: 'SDK发送空字符串' }),
  contactPhone: input('联系电话', '用户输入', {
    type: 'string', required: false, omitted: 'SDK发送空字符串', format: '可选的11位中国大陆手机号', constraints: ['非空时匹配^1[3456789]\\d{9}$'],
  }),
  valueAddedUserId: input('增值会计的系统用户ID；不是员工工号', 'finance-accounting-manage-user-search.list[].id中用户选择一项', {
    type: 'string | number', required: false, nullable: true, omitted: 'SDK发送null，不指定增值会计', nullMeaning: '未指定增值会计', constraints: idRules,
    lookup: { capabilityId: 'finance-accounting-manage-user-search', args: {}, valueField: 'list[].id', labelField: 'list[].label' },
  }),
}

const rowFields = (prefix: string): AiField[] => {
  const at = (name: string) => `${prefix}.${name}`
  return [
    field(at('id'), 'string | number', '账套主记录ID，用于详情和启停；不是法人ID或会计期间ID'),
    field(at('accountingName'), 'string', '账套名称'),
    field(at('accountCode'), 'string', '账套编码，按字符串展示并保留前导零'),
    field(at('currencyType'), 'integer', '账套币种字典值；创建时服务端固定写0=人民币', { nullable: true, nullMeaning: '历史记录未返回币种，不能自行补0' }),
    field(at('corporationId'), 'string | number', '所属法人库ID', { nullable: true, nullMeaning: '历史账套未绑定法人；不能从名称、其他账套或当前组织补ID，启停仍使用账套id' }),
    field(at('corporationName'), 'string', '所属法人单位全称', { nullable: true, nullMeaning: '历史账套未绑定法人或法人服务未返回名称，页面为空；不能据此生成法人ID' }),
    field(at('accountingStandardsApply'), 'integer', '会计准则字典数值，标签来自平台字典'),
    field(at('natureId'), 'string | number', '账套性质主记录ID', { nullable: true, nullMeaning: '历史记录未关联账套性质' }),
    field(at('natureName'), 'string', '账套性质名称', { nullable: true, nullMeaning: '未关联或接口未返回名称' }),
    field(at('isLongTerm'), 'integer', '时效类型', { values: { '0': '时间范围', '1': '长期有效' } }),
    field(at('startTime'), 'string', '开始使用日期', { format: 'YYYY-MM-DD' }),
    field(at('endTime'), 'string', '截止使用日期', { nullable: true, nullMeaning: '长期有效或历史数据未设截止日期', format: 'YYYY-MM-DD' }),
    field(at('periodId'), 'string | number', '关联会计期间主记录ID'),
    field(at('periodYear'), 'string', '会计期间年度', { nullable: true, nullMeaning: '关联期间未解析出年度', format: 'YYYY' }),
    field(at('accuracyId'), 'string | number', '关联会计精度主记录ID'),
    field(at('accuracyName'), 'string', '会计精度名称', { nullable: true, nullMeaning: '关联精度没有名称，页面候选回退显示“精度 #ID”' }),
    field(at('accuracyCurrencyType'), 'integer', '关联会计精度的币种字典值', { nullable: true, nullMeaning: '接口未透传精度币种' }),
    field(at('accuracyDecimalQuantity'), 'integer', '关联会计精度的数量小数位', { nullable: true, nullMeaning: '接口未透传；不能自行假定小数位', unit: '位' }),
    field(at('accuracyDecimalUnitPrice'), 'integer', '关联会计精度的单价小数位', { nullable: true, nullMeaning: '接口未透传；不能自行假定小数位', unit: '位' }),
    field(at('accuracyDecimalAmount'), 'integer', '关联会计精度的金额小数位', { nullable: true, nullMeaning: '接口未透传；不能自行假定小数位', unit: '位' }),
    field(at('industry'), 'string', '行业', { nullable: true, nullMeaning: '未填写' }),
    field(at('creditCode'), 'string', '统一社会信用代码', { nullable: true, nullMeaning: '未填写' }),
    field(at('taxCode'), 'string', '税号', { nullable: true, nullMeaning: '未填写' }),
    field(at('businessAddress'), 'string', '经营地址', { nullable: true, nullMeaning: '未填写' }),
    field(at('contacts'), 'string', '联系人', { nullable: true, nullMeaning: '未填写' }),
    field(at('contactPhone'), 'string', '联系电话', { nullable: true, nullMeaning: '未填写' }),
    field(at('valueAddedUserId'), 'string | number', '增值会计系统用户ID', { nullable: true, nullMeaning: '未指定增值会计' }),
    field(at('valueAddedUserName'), 'string', '增值会计姓名', { nullable: true, nullMeaning: '未指定或用户服务未返回姓名' }),
    field(at('status'), 'integer', '账套状态绝对值', { values: { '0': '启用', '1': '停用' } }),
    field(at('isEnable'), 'integer', '停用账套是否允许点击启用；仅数值1可启用', { nullable: true, nullMeaning: '启用记录或后端未给出可启用标志', values: { '0': '不允许启用', '1': '允许启用' } }),
    field(at('createTime'), 'string | number', '启用时间原值；PC格式化显示', { nullable: true, nullMeaning: '未返回启用时间', constraints: ['部署返回类型未完成多形态浏览器取样，不做时区换算'] }),
  ]
}

const draftFields: AiField[] = [
  field('$', 'object', '创建准备结果，尚未写入'),
  field('draft', 'object', '经过PC规则校验并补齐默认值的创建载荷'),
  ...Object.entries(createInputs).map(([name, definition]) => field(
    `draft.${name}`,
    definition.type ?? 'string',
    definition.meaning,
    {
      optional: false,
      nullable: name === 'valueAddedUserId',
      ...(name === 'endTime' ? { format: 'YYYY-MM-DD或空字符串', constraints: ['长期有效时固定为空字符串'] } : {}),
    },
  )),
  field('draft.status', 'integer', '创建时固定启用', { values: { '0': '启用' } }),
]

const evidence: AiContract['evidence'] = [
  {
    source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/finance/setting/accounting-manage/list.vue 与 [mode]/[id].vue',
    kind: 'reference',
    note: '证明列表筛选/分页、导出、新建、启停、详情路由、表单校验、候选请求与创建POST；两固定检出pull因内网不可达失败，不能声称已同步远端最新。',
  },
  {
    source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 AccountingManageController/ServiceImpl/Mapper及VO',
    kind: 'reference',
    note: '证明分页过滤、创建根Long ID、4位编码及唯一性、法人存在/同法人单一启用账套、启停目标状态与导出字段；固定检出未能pull到远端最新。',
  },
  {
    source: '2026-09-22 main-task独立浏览器会话账套管理基准',
    kind: 'browser',
    note: '确认列表GET逐字段且无module-type、列表六列与停用/详情、详情不新增HTTP并消费列表行；确认新建必填/可选字段及四类候选请求。未点击导出、未创建、未启停。',
  },
  {
    source: 'src/capabilities/finance-accounting-manage.ts 与 test/finance-accounting-manage.test.ts',
    kind: 'test',
    note: '离线锁定请求键、页面字段投影、长候选关键字保护、创建校验、启用按钮保护、导出二进制和AI映射；不替代真实SDK冒烟。',
  },
  {
    source: '2026-09-22 smoke/with-portal-token.sh 公开SDK列表冒烟',
    kind: 'smoke',
    note: '修复后真实启用列表完整返回11行（2条历史账套corporationId=null）；本地详情、会计准则2项、期间1项、精度2项、法人候选、人员候选、导出及describe接线均通过。导出4317字节，响应MIME为application/vnd.ms-excel;charset=UTF-8，但实际文件头为PK/OpenXML；未执行写操作。',
  },
]

const gaps = [
  '浏览器验证了列表、详情与新建候选加载；公开SDK已真实验证列表、详情、四类候选、导出与说明接线。创建POST和启停PUT尚未在真实部署执行。',
  'PC没有删除或编辑动作，创建成功后无法通过本页清理测试账套；因此未自建真实写测试记录，不能修改既有业务账套冒充验证。',
  '固定前端详情源码与当前部署展示范围存在差异：部署详情还展示账套性质及会计精度小数位；SDK按浏览器可见字段保留列表行投影，但尚未取得这些字段的逐值空值基准。',
  'Java固定文件名与MIME仍声明账套管理.xls/application/vnd.ms-excel，但测试部署真实导出以PK开头，是OpenXML ZIP容器；SDK保留服务端文件名并在说明中揭示此差异，不能仅按扩展名推断容器。',
]

function contract(
  purpose: string,
  effect: AiContract['effect'],
  inputs: Record<string, AiParameter>,
  output: AiContract['output'],
  consume: string[],
  steps: AiContract['steps'],
  completion: string,
  extra: Partial<AiContract> = {},
): AiContract {
  return {
    purpose,
    whenToUse: '操作门户系统“财务设置→账套管理”PC页面；不用于会计期间维护、会计精度维护、财务初始化或其他系统的账套候选。',
    boundaries: [
      '该菜单虽在finance目录，但真实PC系统选择器将顶层无system菜单归入目标门户系统；能力仍使用platform HTTP实例。',
      '页面无法推导module-type，SDK与浏览器一致不发送该头；仍由会话携带tenant-id，一个HTTP实例只绑定一个用户和租户。',
      '当前PC可达动作为列表/筛选/分页、导出、新建、启停、详情及新建所需候选；页面没有编辑、删除、导入、打印、上传下载或审批。后端update/get等无当前页面入口的接口不发布。',
      '详情不发网络请求，而是投影用户从最新列表选中的整行快照；需要当前值必须先刷新列表。',
      '历史账套允许corporationId/corporationName为空；查询、详情与启停仍可使用账套id，不能从名称或其他行补法人ID。创建账套仍必须从法人候选选择corporationId。',
      '导出在PC中由window.open直连同一个VITE_ZHDJ_PLATFORM_API host；SDK复用同一platform页面请求与会话头，以arraybuffer返回文件，不打开浏览器窗口。',
      '法人和人员原PC组件可批量加载；SDK为防止长候选冲掉调用方上下文，改成必须给关键字的小页查询，这是有意的无头保护。',
    ],
    effect,
    prerequisites: ['已建立带有效会话token、tenantId与platform baseUrl的SDK；账号须有页面及对应按钮权限。', '实体ID必须来自本页候选或最新列表，不能使用文档样例ID。'],
    inputs,
    output,
    consume,
    steps,
    completion,
    failures: [
      'SDK输入校验失败时不发请求；按错误修正日期、ID、状态、分页或手机号后再调用。',
      '401/403、网络或后端业务错误原样抛出，不当成空列表、空候选或写入成功；恢复会话/权限后读请求可重试。',
      '创建时编码重复、法人不存在或同法人已有另一启用账套会被后端拒绝；刷新账套列表和候选后修正业务输入，不用换租户或盲目重试绕过。',
      '写请求超时或断网时结果不确定：先按编码/名称/状态分页核实，不自动重复创建或切换状态。',
    ],
    idempotency: effect === 'write' ? '具体写动作的防重与重试边界见该动作说明；后端没有请求幂等键。' : null,
    evidence,
    gaps,
    ...extra,
  }
}

export const FINANCE_ACCOUNTING_MANAGE_AI_CONTRACTS: Record<string, AiContract> = {
  'finance-accounting-manage-list': contract(
    '按法人、编码、名称、会计准则、年度与状态分页查询账套，返回列表及详情/启停所需字段。',
    'read',
    listInputs,
    {
      shape: '{ list: array, total: integer }',
      fields: [field('$', 'object', '账套分页'), field('list', 'array', '当前页记录，不是全部账套'), field('list[]', 'object', '一条账套列表行与详情快照'), ...rowFields('list[]'), field('total', 'integer', '相同筛选条件下的总记录数')],
      empty: 'list=[]表示当前页无记录；total=0表示当前筛选无记录。超过末页的空页不代表其他筛选无数据。',
    },
    ['列表只展示名称、编码、法人、准则、期间年度、状态和启用时间；详情字段仅在用户查看时展开。', '需要完整结果时保持筛选不变递增pageNo，累计达到total或返回空页后结束。'],
    [
      { role: 'optional', when: '用户选择一行查看详情', capabilityId: 'finance-accounting-manage-detail', mapping: { row: 'result.list[]' }, instruction: '只传用户选中的一行完整投影；该动作本地完成，不声称重新读取后端。' },
      { role: 'optional', when: '用户要导出当前筛选', capabilityId: 'finance-accounting-manage-export', mapping: { corporationId: 'args.corporationId', accountCode: 'args.accountCode', accountingName: 'args.accountingName', accountingStandardsApply: 'args.accountingStandardsApply', periodYear: 'args.periodYear', status: 'args.status' }, instruction: '沿用当前筛选，不传分页。' },
      { role: 'optional', when: '用户确认把一行切换到相反状态', capabilityId: 'finance-accounting-manage-set-status', mapping: { id: 'result.list[].id', currentStatus: 'result.list[].status', isEnable: 'result.list[].isEnable' }, instruction: '补充status为currentStatus的相反值；停用行只有isEnable=1时才能启用。' },
    ],
    '已交付请求页与筛选总数，没有导出或修改任何账套。',
  ),

  'finance-accounting-manage-detail': contract(
    '把最新账套列表行投影为PC详情，不发网络请求。',
    'local',
    {
      row: input('用户从最新账套列表选中的完整行快照', 'finance-accounting-manage-list.list[]', { type: 'object' }),
      ...Object.fromEntries(rowFields('row').map(item => [item.path, input(
        item.meaning,
        `finance-accounting-manage-list.${item.path.replace(/^row\./, 'list[].')}`,
        {
          type: item.type,
          required: true,
          nullable: item.nullable,
          ...(item.constraints ? { constraints: item.constraints } : {}),
        },
      )])),
    },
    { shape: 'object', fields: [field('$', 'object', '账套详情快照'), ...rowFields('$').map(item => ({ ...item, path: item.path.replace(/^\$\./, '') }))], empty: '合法列表行总返回对象；字段为空按逐字段null语义解释。非法或缺字段行抛错。' },
    ['展示币种、法人、准则、账套性质、时效、起止日期、精度及小数位、会计期间和联系资料。', '详情是打开时快照；要判断当前状态或启用条件必须重新list。'],
    [],
    '已得到本地详情快照；没有发请求，也没有修改记录。',
    { idempotency: null },
  ),

  'finance-accounting-manage-export': contract(
    '按当前账套筛选导出Excel，并返回可保存的base64文件。',
    'read',
    Object.fromEntries(Object.entries(listInputs).filter(([name]) => !['pageNo', 'pageSize'].includes(name))),
    {
      shape: '{ fileName, contentType, base64, byteLength }',
      fields: [
        field('$', 'object', '账套导出文件'), field('fileName', 'string', '建议保存文件名，固定账套管理.xls'),
        field('contentType', 'string', 'HTTP Content-Type原值', { nullable: true, nullMeaning: '服务端未返回类型头，仍可按文件名保存' }),
        field('base64', 'string', '导出文件二进制的base64编码；不是日志或JSON。测试部署实际字节以PK开头，是OpenXML ZIP容器，虽服务端文件名仍为.xls'), field('byteLength', 'integer', '解码后字节数，用于完整性检查', { unit: 'byte' }),
      ],
      empty: '空文件被SDK拒绝并抛错；成功base64非空且byteLength大于0。',
    },
    ['用base64解码为二进制；不要把base64直接当文本展示。服务端固定返回.xls文件名，但测试部署内容是PK/OpenXML容器，调用方如校验格式应以文件头而非扩展名为准。', '导出包含服务端返回的全部筛选记录，不由pageNo/pageSize截断。'],
    [],
    '已取得非空导出二进制；未修改账套。',
  ),

  'finance-accounting-manage-corporation-search': contract(
    '按法人名称关键字分页搜索账套所属法人候选。',
    'read',
    {
      keyword: input('法人名称非空关键字', '用户输入至少一个可消歧字符', { type: 'string', constraints: ['SDK会trim并拒绝空白；这是长候选无头保护'] }),
      pageNo: { ...pageNo },
      pageSize: { ...pageSize, constraints: ['1至100；SDK默认20'] },
    },
    {
      shape: '{ list: array, total: integer }',
      fields: [field('$', 'object', '法人候选分页'), field('list', 'array', '本页名称匹配候选'), field('list[]', 'object', '一个法人候选'), field('list[].id', 'string | number', '法人库ID'), field('list[].name', 'string', '法人全称'), field('total', 'integer', '相同名称条件下候选总数')],
      empty: 'list=[]且total=0表示当前名称无候选；权限或网络失败抛错。',
    },
    ['按name展示并让用户选择一项，把id用于corporationId；名称不能代替ID。'],
    [],
    '已交付一页消歧候选，没有创建账套。',
  ),

  'finance-accounting-manage-accounting-standards-options': contract(
    '从平台字典读取账套可选会计准则。',
    'read',
    {},
    {
      shape: '{ list: array }',
      fields: [field('$', 'object', '会计准则候选'), field('list', 'array', '当前平台字典accounting_standards_apply的数据'), field('list[]', 'object', '一个字典候选'), field('list[].id', 'string | number', '字典数据记录ID，仅用于追踪'), field('list[].value', 'integer', '创建和筛选实际提交的会计准则数值'), field('list[].label', 'string', 'PC展示标签')],
      empty: '字典类型缺失或响应异常会抛错，不返回伪造空选项；合法字典可能返回空list。',
    },
    ['展示label、提交value；不要提交字典记录id或标签。'],
    [],
    '已得到当前字典候选，没有修改账套。',
  ),

  'finance-accounting-manage-accounting-period-options': contract(
    '按开始年度与时效类型读取并过滤可用会计期间候选。',
    'read',
    {
      startTime: createInputs.startTime!,
      isLongTerm: createInputs.isLongTerm!,
    },
    {
      shape: '{ list: array, total: integer }',
      fields: [field('$', 'object', '过滤后的启用会计期间候选'), field('list', 'array', '时间范围只保留同年，长期有效保留开始年及以后'), field('list[]', 'object', '一个会计期间候选'), field('list[].id', 'string | number', '会计期间主记录ID'), field('list[].year', 'integer', '期间年度，用作选项标签'), field('total', 'integer', '本地过滤后的候选数')],
      empty: 'list=[]表示没有符合开始年度和时效类型的启用期间；创建前应先维护会计期间。',
    },
    ['由用户选一项id填periodId；时间范围通常仅一项同年候选，长期有效仍须用户确认起始期间。'],
    [],
    '已交付可用期间候选，没有创建账套。',
  ),

  'finance-accounting-manage-accuracy-options': contract(
    '读取所有启用会计精度候选及PC展示的小数位信息。',
    'read',
    {},
    {
      shape: '{ list: array }',
      fields: [
        field('$', 'object', '启用会计精度候选'), field('list', 'array', '状态0的全部精度候选'), field('list[]', 'object', '一个会计精度候选'),
        field('list[].id', 'string | number', '会计精度主记录ID'), field('list[].name', 'string', '精度名称；缺失时回退为“精度 #ID”'),
        field('list[].currencyType', 'integer', '精度币种字典值', { nullable: true, nullMeaning: '未配置' }),
        field('list[].decimalQuantity', 'integer', '数量小数位', { nullable: true, nullMeaning: '未配置', unit: '位' }),
        field('list[].decimalUnitPrice', 'integer', '单价小数位', { nullable: true, nullMeaning: '未配置', unit: '位' }),
        field('list[].decimalAmount', 'integer', '金额小数位', { nullable: true, nullMeaning: '未配置', unit: '位' }),
      ],
      empty: 'list=[]表示当前没有启用精度；创建账套前须先维护会计精度。',
    },
    ['展示名称、币种和三类小数位，让用户选一项id填accuracyId；不要用小数位组合猜ID。'],
    [],
    '已得到启用精度候选，没有创建账套。',
  ),

  'finance-accounting-manage-user-search': contract(
    '按姓名关键字分页搜索在职或返聘用户，供选择增值会计。',
    'read',
    {
      keyword: input('人员姓名非空关键字', '用户输入至少一个可消歧字符', { type: 'string', constraints: ['SDK会trim并拒绝空白；不允许无关键字全量拉取'] }),
      pageNo: { ...pageNo },
      pageSize: { ...pageSize, constraints: ['1至100；SDK默认20'] },
    },
    {
      shape: '{ list: array, total: integer }',
      fields: [field('$', 'object', '增值会计候选分页'), field('list', 'array', '当前页在职/返聘候选'), field('list[]', 'object', '一个系统用户候选'), field('list[].id', 'string | number', '系统用户ID'), field('list[].realName', 'string', '姓名'), field('list[].username', 'string', '工号，按字符串保留前导零'), field('list[].label', 'string', 'PC标签“姓名(工号)”'), field('total', 'integer', '相同姓名和状态范围的候选总数')],
      empty: 'list=[]且total=0表示当前关键字无在职/返聘候选；失败抛错。',
    },
    ['用label消歧，只把id写入valueAddedUserId；人员候选是可选字段，不得自动选择首项。'],
    [],
    '已交付一页人员候选，没有创建账套。',
  ),

  'finance-accounting-manage-prepare-create': contract(
    '校验账套创建字段并生成与PC POST一致的草稿，不发写请求。',
    'prepare',
    createInputs,
    { shape: '{ draft: object }', fields: draftFields, empty: '合法输入返回完整draft；校验失败抛错，不返回部分草稿。' },
    ['向用户展示名称、编码、法人、准则、时效、日期、期间、精度及可选联系信息；币种由服务端固定人民币，不让用户填写。', '确认长期有效时draft.endTime为空字符串；时间范围时核对同年且结束不早于开始。'],
    [{
      role: 'required', when: '用户核对草稿后明确要求保存', capabilityId: 'finance-accounting-manage-create',
      mapping: Object.fromEntries([...Object.keys(createInputs).map(name => [name, `result.draft.${name}`]), ['requestId', 'context.requestId']]),
      instruction: '调用createRequestId()取得context.requestId；create会重新校验并生成载荷，不接收status或currencyType覆盖服务端规则。',
    }],
    '只完成本地校验与预览；没有创建账套。',
    { idempotency: null },
  ),

  'finance-accounting-manage-create': contract(
    '创建一个默认启用、币种由服务端固定为人民币的账套，返回账套主记录ID。',
    'write',
    { ...createInputs, requestId: input('SDK短窗口写入防重键；不发送给Portal后端', '调用方用createRequestId()为本次创建意图生成，同一意图超时重试复用', { type: 'string', constraints: ['新意图换新值；同键不同载荷拒绝；跨进程不共享'] }) },
    { shape: 'string | number', fields: [field('$', 'string | number', '新建账套主记录ID，用于列表核对与启停')], empty: '后端应返回正ID；缺失或非法ID会抛错，不能当作已创建。' },
    ['保存根ID；用编码、名称、状态0逐页查找同一ID，核对法人、期间、精度和日期。', '页面没有删除或编辑，创建后不能承诺通过本页撤销；真实环境不得为测试随意留下账套。'],
    [{ role: 'required', when: '创建返回ID或写结果不确定，需要独立核实', capabilityId: 'finance-accounting-manage-list', mapping: { accountCode: 'args.accountCode', accountingName: 'args.accountingName', status: 'literal:0' }, instruction: '逐页查找result.$对应ID并核对关键字段；无候选或多个冲突时保持结果不确定，不自动重建。' }],
    '仅在列表独立回查同一ID及关键字段一致后报告创建已核实；请求返回ID本身不等于完整闭环。',
    { idempotency: '公开createIdempotent使用SDK进程内短窗口防重：requestId按用户/租户/能力隔离，同键同载荷复用进行中或已成功结果，同键不同载荷拒绝；不跨进程，后端无幂等键。超时先回查。' },
  ),

  'finance-accounting-manage-set-status': contract(
    '按最新列表行保护把账套切换为相反的启用或停用状态。',
    'write',
    {
      id: input('账套主记录ID', 'finance-accounting-manage-list.list[].id', { type: 'string | number', constraints: idRules }),
      currentStatus: input('操作前最新列表行状态', 'finance-accounting-manage-list.list[].status', { type: 'integer', options: statusOptions }),
      status: input('目标绝对状态，必须与currentStatus相反', '用户意图：当前0停用传1，当前1启用传0', { type: 'integer', options: statusOptions }),
      isEnable: input('停用账套是否允许启用的后端标志', 'finance-accounting-manage-list.list[].isEnable', { type: 'integer', required: false, nullable: true, omitted: '停用转启用时缺失会被SDK拒绝；启用转停用无需该字段', nullMeaning: '页面没有给出可启用许可', options: [{ value: 0, label: '不允许启用' }, { value: 1, label: '允许启用' }] }),
    },
    { shape: 'boolean', fields: [field('$', 'boolean', '后端启停成功数据；SDK只接受true')], empty: '成功返回true；false、缺失或错误响应均抛错，且仍须列表回查终态。' },
    ['操作前保存currentStatus；启用记录可停用，停用记录仅isEnable=1时可启用。', '返回true后按目标status分页查找同一ID；只有读回目标状态才确认生效。'],
    [
      { role: 'required', when: '启停返回true或超时，需要确认终态', capabilityId: 'finance-accounting-manage-list', mapping: { status: 'args.status' }, instruction: '逐页查找args.id；找到同一ID且status一致才确认，未找到不等于记录不存在。' },
      { role: 'cancel', when: '本次启停已核实且用户明确要求恢复，且保存了操作前状态和最新isEnable', capabilityId: 'finance-accounting-manage-set-status', mapping: { id: 'args.id', currentStatus: 'args.status', status: 'args.currentStatus', isEnable: 'context.restoreIsEnable' }, instruction: '恢复是第二次写；若恢复目标为启用，context.restoreIsEnable必须来自恢复前最新停用行且为1，随后再次列表回查。' },
    ],
    '列表回查同一ID为目标status后才报告启停已核实；只收到true只能报告请求完成。',
    { idempotency: '不接收requestId；请求写绝对目标状态且要求currentStatus与目标相反。超时先列表回查，不能用旧currentStatus并发重发。' },
  ),
}

export const FINANCE_ACCOUNTING_MANAGE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(FINANCE_ACCOUNTING_MANAGE_METHODS).map(([capabilityId, method]) => {
    const source = FINANCE_ACCOUNTING_MANAGE_AI_CONTRACTS[capabilityId]!
    return [`financeAccountingManage.${method}`, {
      ...source,
      boundaries: [
        ...source.boundaries,
        `公开方法签名financeAccountingManage.${method}(args)，单个对象参数；list/exportExcel/accountingStandardsOptions/accuracyOptions可省略args。能力invoke同样使用对象，字段与inputs一致。`,
      ],
    }]
  }),
)
