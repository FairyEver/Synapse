import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { SALE_SETTING_DICT_METHODS } from '../capabilities/sale-setting-dict.js'

const param = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, ...extra })
const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, ...extra })

const idInput = param('配置数据类型主键，不是字典数据条目 ID', 'sale-setting-dict-list 的 list[].id，由用户选择一条记录', { type: 'string | number', required: true, constraints: ['必须是正整数；保留长 ID 字符串。'] })
const idsInput = param('要删除的配置数据类型主键数组；单条也传一个元素', '用户从 sale-setting-dict-list 选择的 list[].id', { type: 'array', required: true, constraints: ['不得为空；SDK 去重；不能传名称或子级字典数据 ID。'] })
const idsItem = param('数组中的一个配置数据类型 ID', '用户选中的 sale-setting-dict-list.list[].id', { type: 'string | number', required: true })
const draftInputs: Record<string, AiParameter> = {
  dictName: param('字典名称，中文显示名', '用户输入；修改时先读取 sale-setting-dict-get.dictName', { type: 'string', required: true, constraints: ['不能为空或全为空格；服务端按 NotBlank 校验。'] }),
  dictType: param('字典类型，业务使用的英文代码', '用户输入；修改时先读取 sale-setting-dict-get.dictType', { type: 'string', required: true, constraints: ['不能为空或全为空格；不能与要维护的字典数据条目 ID 混用。'] }),
  sort: param('字典类型列表排序值', '用户输入；页面默认 0', { type: 'integer', required: false, omitted: 'SDK 补 0；Portal 表单初始值也是 0', constraints: ['不能为负数；后端 DTO 为 Integer。'] }),
  remark: param('字典类型备注', '用户输入；页面默认空字符串', { type: 'string', required: false, omitted: 'SDK 补空字符串', constraints: ['页面没有长度或非空校验。'] }),
}

const rowFields = (prefix: string): AiField[] => {
  const at = (key: string) => prefix ? `${prefix}.${key}` : key
  return [
    field(at('id'), 'string | number | null', '配置数据类型主键；用于详情、修改和删除，不是字典数据条目 ID', { nullable: true, nullMeaning: '没有主键，不能继续执行按 ID 的写操作' }),
    field(at('dictName'), 'string | null', '字典类型中文名称', { nullable: true, nullMeaning: '服务端未返回名称，不能把它当成有效名称' }),
    field(at('dictType'), 'string | null', '字典类型英文代码；子页按该类型读取字典数据', { nullable: true, nullMeaning: '服务端未返回英文代码，不能据此进入或修改子级数据' }),
    field(at('sort'), 'number | null', '字典类型排序值；页面展示原始数值', { nullable: true, nullMeaning: '服务端未返回排序值' }),
    field(at('remark'), 'string | null', '字典类型备注', { nullable: true, nullMeaning: '未填写备注或服务端返回空值' }),
    field(at('createDate'), 'string | number | null', '创建时间原值', { nullable: true, nullMeaning: '服务端未返回创建时间' }),
    field(at('updateDate'), 'string | number | null', '更新时间原值', { nullable: true, nullMeaning: '服务端未返回更新时间' }),
  ]
}

const voidOutput: AiContract['output'] = {
  shape: 'undefined',
  fields: [field('$', 'undefined', '后端保存或删除成功包络没有业务数据；SDK 不伪造 ID、条数或布尔值')],
  empty: 'Promise 正常完成表示请求成功，根值为 undefined；写入结果必须通过查询核实。',
}

const evidence = [
  { source: 'app/portal/views/dashboard/sale/setting/dict/list.vue 与 [mode]/[id].vue @ 3622e02147', kind: 'reference' as const, note: '证明 sale.js 实例、列表筛选、分页、批量删除、创建/编辑导航和表单字段/默认值。' },
  { source: 'ManageSysDictTypeController / ManageSysDictTypeServiceImpl / SysDictTypeDTO @ c3348150f42', kind: 'reference' as const, note: '证明 /dict/type 的 page/get/POST/PUT/DELETE 路由、NotBlank、sort 最小值和字典类型字段。' },
  { source: 'src/capabilities/sale-setting-dict.ts 与 test/sale-setting-dict.test.ts', kind: 'implementation' as const, note: '证明 SDK 最终请求形状、输入校验、返回字段和离线反证；不替代真实环境写入回查。' },
]

const common = (effect: AiContract['effect'], purpose: string, inputs: Record<string, AiParameter>, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): AiContract => ({
  purpose,
  whenToUse: purpose,
  boundaries: [
    '覆盖销售系统“配置数据”根列表/字典类型 CRUD，以及该页“字典数据”子页面可达的批量删除动作；子页面的查询、详情和保存由独立能力负责或仍需单独收敛。',
    '请求使用当前会话用户、租户、sale 实例和 module-type=60；后端权限或租户范围错误原样抛出。',
    '当前证据来自固定 Portal/Java 源码和离线请求夹具，尚无本页真实测试环境浏览器基准和线上写入回查记录。',
  ],
  effect,
  prerequisites: ['已创建带会话 token 和 tenantId 的 SDK；写操作的 ID 来自当前用户可见列表。'],
  inputs,
  output,
  consume,
  steps: [],
  completion: '交付本能力真实返回的数据；写请求成功不等于业务结果已核实。',
  failures: ['权限、登录、网络或后端校验错误原样抛出，不解释为空结果；写入超时先查询核实，不能盲目重发。'],
  idempotency: effect === 'write' ? '无 SDK 或后端 requestId 幂等保证；失败或超时先查询核实，重复保存/删除可能产生重复或覆盖，不能把空回执当幂等证明。' : null,
  evidence,
  ...extra,
})

export const SALE_SETTING_DICT_AI_CONTRACTS: Record<string, AiContract> = {
  'sale-setting-dict-list': common('read', '分页查询销售系统配置数据的字典类型，按中文名称和英文类型模糊筛选。', {
    dictName: param('中文名称筛选片段', '用户输入', { type: 'string', required: false, omitted: 'SDK 发空字符串，表示不按名称筛选' }),
    dictType: param('英文类型筛选片段', '用户输入', { type: 'string', required: false, omitted: 'SDK 发空字符串，表示不按类型筛选' }),
    pageNo: param('页码，从 1 开始', '调用方分页状态', { type: 'integer', required: false, default: 'SDK 默认 1' }),
    pageSize: param('每页记录数', '调用方分页状态', { type: 'integer', required: false, default: 'SDK 默认 20', constraints: ['接受 Portal 分页值 10/20/50/100/200/500；sale 实例发出时将 pageSize 改为 limit。'] }),
    order: param('列表排序方向协议字段', '调用方排序状态', { type: 'string', required: false, omitted: 'SDK 发空字符串；页面没有自定义排序控件' }),
    orderField: param('列表排序字段协议字段', '调用方排序状态', { type: 'string', required: false, omitted: 'SDK 发空字符串；不要自行猜字段名' }),
  }, { shape: '{ list: object[], total: number }', fields: [field('$', 'object', '配置数据类型分页结果'), field('list', 'object[]', '当前页字典类型'), field('list[]', 'object', '字典类型记录；未列出的扩展字段不属于本页消费契约'), ...rowFields('list[]'), field('total', 'number', '符合筛选条件的总记录数，不是当前页条数')], empty: 'list=[] 表示当前页无记录；total=0 才表示筛选无记录，网络/权限失败抛错。' }, ['展示 dictName、dictType、sort、remark 和时间；保留 id 供编辑/删除。', '需要全量时继续按 pageNo 翻页到 total，不把一页误当全量。'], {
    completion: '交付当前筛选页；用户要进入“字典数据”子页时先选择记录并传递 result.list[].id，由子页面能力继续处理。',
    steps: [{ role: 'optional', when: '用户要编辑某个字典类型', capabilityId: 'sale-setting-dict-get', mapping: { id: 'user.selected.id' }, instruction: '使用用户选中的字典类型主键读取详情，不用 dictType 字符串代替 id。' }],
  }),
  'sale-setting-dict-get': common('read', '读取一个配置数据字典类型的编辑详情。', { id: idInput }, { shape: 'object | null', fields: [field('$', 'object | null', '字典类型详情', { nullable: true, nullMeaning: '没有该类型详情，不能据此继续编辑' }), ...rowFields('')], empty: 'null 表示未找到类型；不要用旧缓存或空对象代替。' }, ['读取 dictName、dictType、sort、remark 和 id，编辑时完整提交可编辑字段；createDate/updateDate 只展示。'], {
    completion: '获得当前表单值；尚未产生修改。',
    steps: [{ role: 'optional', when: '用户确认保存修改', capabilityId: 'sale-setting-dict-update', mapping: { id: 'result.id', dictName: 'result.dictName', dictType: 'result.dictType', sort: 'result.sort', remark: 'result.remark' }, instruction: '保留未修改字段；null 的 sort/remark 按页面默认值处理，不能丢失类型 ID。' }],
  }),
  'sale-setting-dict-create': common('write', '创建一个配置数据字典类型，保存中文名称、英文类型、排序和备注。', draftInputs, voidOutput, ['保存成功无新建 ID；按精确 dictType 或 dictName 查询并核对全部字段，取得新 id 后再进入字典数据子页。'], {
    completion: 'Promise 完成只表示 POST 被接受；精确查询核对新记录后才报告创建已验证。',
    steps: [{ role: 'required', when: '创建完成或超时需要核实', capabilityId: 'sale-setting-dict-list', mapping: { dictType: 'args.dictType' }, instruction: '按英文类型查询并逐页精确匹配 dictType，再核对 dictName、sort、remark；无记录或多个匹配不能猜测结果。' }],
  }),
  'sale-setting-dict-update': common('write', '更新一个已有配置数据字典类型的完整表单。', { id: idInput, ...draftInputs }, voidOutput, ['先 get 读取当前详情，再提交完整 dictName、dictType、sort、remark；不要把字典数据条目 ID 传入。'], {
    completion: '保存成功后 get 同一 id 并逐字段核对新值，才报告修改已验证。',
    steps: [{ role: 'required', when: '更新完成或超时需要核实', capabilityId: 'sale-setting-dict-get', mapping: { id: 'args.id' }, instruction: '核对 dictName、dictType、sort、remark；不能以空回执代替回查。' }],
  }),
  'sale-setting-dict-remove': common('write', '批量删除配置数据字典类型记录。', { ids: idsInput, 'ids[]': idsItem }, voidOutput, ['SDK 发送去重后的 ID 数组；删除后按此前记录的 dictType 或 dictName 分页核对目标 ID 已不存在。', '删除字典类型可能同时影响其字典数据子项；不要把删除类型解释成已核实清理所有子项。'], {
    completion: '请求成功且列表回查不再出现所选 ID 后，才报告根列表删除已验证；子级数据的实际状态需用其独立页面能力确认。',
    steps: [{ role: 'required', when: '删除返回或超时需要核实', capabilityId: 'sale-setting-dict-list', mapping: { dictType: 'user.recordTypes' }, instruction: '按之前记录的英文类型逐页查询并核对每个所选 ID；不要只检查第一页。' }],
    failures: ['删除超时结果不确定；先按 dictType/dictName 查询核实，未核实前不能重发。', '后端拒绝删除时不声称部分成功；保留原 ID 列表逐项回查。'],
  }),
  'sale-setting-dict-data-prepare-remove': common('prepare', '按字典数据子页面选中的条目ID准备批量删除草稿，不发送DELETE。', { ids: param('字典数据子页面选中的条目ID数组。', 'Portal字典数据子页面当前列表选中行id', { type: 'array', required: true, constraints: ['至少一个正整数ID；SDK去重；不能传字典类型主键或名称。'] }) }, { shape: '{ draft: { ids: string[] } }', fields: [field('draft', 'object', '删除请求草稿'), field('draft.ids', 'string[]', '去重后的字典数据条目ID数组')], empty: 'ids为空或包含非法ID时抛错；不发送请求。' }, ['展示待删条目并取得明确确认；确认后原样交给sale-setting-dict-data-remove；取消调用本地cancel能力。'], { effect: 'prepare', steps: [{ role: 'required', when: '用户明确确认删除字典数据', capabilityId: 'sale-setting-dict-data-remove', mapping: { draft: 'result.draft' }, instruction: '提交同一份draft；请求体必须是裸ID数组。' }, { role: 'cancel', when: '用户取消删除', capabilityId: 'sale-setting-dict-data-cancel-remove', mapping: {}, instruction: '丢弃draft，不发送DELETE。' }], completion: '得到去重、可提交且尚未产生网络副作用的子页面删除草稿。' }),
  'sale-setting-dict-data-remove': common('write', '删除配置数据子页面中用户选定的字典数据条目。', { draft: param('prepareRemoveData返回的完整删除草稿。', 'sale-setting-dict-data-prepare-remove.result.draft', { type: 'object', required: true, constraints: ['ids必须是同一批当前列表选中的字典数据条目ID。'] }) }, voidOutput, ['请求使用DELETE /admin/dict/data，body是裸ID数组；完成后必须回到子页面按同一字典类型逐页核对目标ID已消失。'], { effect: 'write', steps: [{ role: 'recovery', when: '删除成功、超时或响应丢失后核实', sdkPath: 'saleSysDict.list', mapping: { type: 'context.dictType' }, instruction: '如该子页对应旧销售字典列表，按保存的dictType和原筛选逐页核对目标ID；若当前部署没有对应查询路由，必须报告无法独立核实。' }], completion: '请求完成且子页面列表回查确认目标条目不存在；无法回查时只报告请求结果，不报告已验证。' }),
  'sale-setting-dict-data-cancel-remove': common('local', '取消配置数据子页面删除的本地草稿，不发送DELETE。', {}, { shape: '{ cancelled: true }', fields: [field('cancelled', 'boolean', '固定为true，表示本地草稿已放弃')], empty: '不发HTTP请求。' }, ['只表示提交前草稿已丢弃；不能撤销已经提交的字典数据删除。'], { effect: 'local', steps: [], completion: '返回cancelled=true且没有网络副作用。', idempotency: null }),
}

export const SALE_SETTING_DICT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(SALE_SETTING_DICT_METHODS).map(([capabilityId, method]) => [`saleSettingDict.${method}`, { ...SALE_SETTING_DICT_AI_CONTRACTS[capabilityId]!, boundaries: [...SALE_SETTING_DICT_AI_CONTRACTS[capabilityId]!.boundaries, '直接方法签名为单个参数对象；键名与 inputs 一致，list 可省略参数对象。'] }]))
