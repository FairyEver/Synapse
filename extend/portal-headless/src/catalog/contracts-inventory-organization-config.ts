import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { INVENTORY_ORGANIZATION_CONFIG_METHODS } from '../capabilities/inventory-organization-config.js'

const field = (path: string, type: string, meaning: string, extra: Partial<AiField> = {}): AiField => ({ path, type, meaning, optional: false, nullable: false, ...extra })
const input = (meaning: string, source: string, extra: Partial<AiParameter> = {}): AiParameter => ({ meaning, source, required: true, ...extra })
const optional = (meaning: string, source: string, omitted: string, extra: Partial<AiParameter> = {}): AiParameter => input(meaning, source, { required: false, omitted, ...extra })
const idRules = ['安全正整数或无前导零的正整数字符串；长ID保留字符串', '不能用法人名称或列表行号代替ID']

const rowFields = (prefix: string): AiField[] => {
  const at = (key: string) => prefix ? `${prefix}.${key}` : key
  return [
    field(at('id'), 'string | number', '资产编码规则主键；删除使用', { optional: true, nullable: true, nullMeaning: '后端未返回主键', constraints: idRules }),
    field(at('orgId'), 'string | number', '法人单位ID', { nullable: true, nullMeaning: '后端未返回法人单位ID', constraints: idRules }),
    field(at('orgCode'), 'string', '组织编码，页面创建表单最多4字符', { nullable: true, nullMeaning: '后端未返回组织编码' }),
    field(at('orgName'), 'string', '法人单位名称；仅用于展示', { nullable: true, nullMeaning: '后端未返回法人名称' }),
    field(at('creator'), 'string | number', '创建人ID', { optional: true, nullable: true, nullMeaning: '后端未返回创建人ID', constraints: idRules }),
    field(at('creatorName'), 'string', '创建人名称', { nullable: true, nullMeaning: '后端未返回创建人名称' }),
    field(at('createTime'), 'string', '创建时间原值', { nullable: true, nullMeaning: '后端未返回创建时间' }),
  ]
}

const listOutput: AiContract['output'] = { shape: '{ list: array, total: integer }', fields: [field('$', 'object', '资产编码规则分页'), field('list', 'array', '当前页记录'), field('list[]', 'object', '一条资产编码规则'), ...rowFields('list[]'), field('total', 'integer', '筛选总数')], empty: 'list=[]且total=0表示无匹配记录；权限、网络或响应错误会抛出。' }
const corporationsOutput: AiContract['output'] = { shape: 'array', fields: [field('$', 'array', '法人单位候选'), field('[]', 'object', '一个法人单位候选'), field('[].id', 'string | number', '法人单位ID', { constraints: idRules }), field('[].name', 'string', '法人单位名称')], empty: '[]表示当前会话没有可见法人单位。' }
const voidOutput: AiContract['output'] = { shape: 'undefined', fields: [field('$', 'undefined', '写请求成功无业务返回值；失败抛错')], empty: 'Promise完成只表示服务端接受请求，不等于列表已独立回查。' }
const createOutput: AiContract['output'] = { shape: '{ rows: array }', fields: [field('$', 'object', '创建前本地草稿'), field('rows', 'array', '按Portal弹窗排序的创建行'), field('rows[]', 'object', '一条创建行'), field('rows[].orgCode', 'string', '组织编码，最多4字符'), field('rows[].orgId', 'string | number', '法人单位ID', { constraints: idRules })], empty: '没有创建行或字段非法时抛错；取消时不调用create。' }
const removeOutput: AiContract['output'] = { shape: '{ id: string | number }', fields: [field('$', 'object', '删除前本地确认草稿'), field('id', 'string | number', '待删除规则ID', { constraints: idRules })], empty: 'id非法时抛错；取消时不调用remove。' }
const inputs: Record<string, AiParameter> = {
  orgId: optional('法人单位ID筛选', 'Portal法人单位下拉框', 'SDK发送null，不限制法人单位', { type: 'string | number', nullable: true, constraints: idRules }),
  pageNo: optional('页码，从1开始', 'Portal分页状态', 'SDK默认1', { type: 'integer' }),
  pageSize: optional('每页条数', 'Portal分页状态', 'SDK默认20', { type: 'integer', constraints: ['10、20、50、100、200、500'] }),
}
const rowsInput: Record<string, AiParameter> = { rows: input('创建行数组；每行都要有组织编码和法人单位ID', 'Portal“创建组织编码”弹窗', { type: 'array', constraints: ['至少一行；orgCode必填且最多4字符；orgId必须为法人单位ID'] }) }
const evidence: AiContract['evidence'] = [
  { source: 'CodeReview_Projects_Js@test/portal/main:d3cf56bdc7 app/portal/views/dashboard/material/assets/code-setting/list.vue 与 components/create-code.vue、portal/material/select/corporation/index.vue', kind: 'reference', note: '证明筛选、法人候选、批量创建数组、删除确认和DELETE query id请求；固定检出未pull。' },
  { source: 'CodeReview_Mall_Platform_Java@test/test:dcb3f360194 OrganizationConfigController、OrganizationConfigSaveReqVO、RespVO', kind: 'reference', note: '证明create接收数组、delete接收query id和分页字段；固定检出未pull。' },
  { source: 'src/capabilities/inventory-organization-config.ts', kind: 'implementation', note: '证明SDK提交数组、ID校验和候选端点。' },
  { source: 'test/inventory-organization-config.test.ts', kind: 'test', note: '离线锁定页面与Controller端点、数组提交、删除query和坏响应。' },
]
const base = (value: Omit<AiContract, 'whenToUse' | 'boundaries' | 'prerequisites' | 'failures' | 'evidence' | 'gaps'>): AiContract => ({
  whenToUse: '操作Portal“资产编码”列表和创建组织编码弹窗。',
  boundaries: ['能力归属于Portal系统设置下的资产编码菜单，不等同于资产系统其它菜单。', '创建请求是数组，每行orgCode与orgId一一对应；法人名称只能用于展示和候选选择，提交必须使用ID。', '页面没有编辑入口；删除使用Portal自定义DELETE query id，不扩展后端其它CRUD。'],
  prerequisites: ['已创建带有效会话token、tenantId和资产编码页面上下文的SDK。', '写操作必须保留用户确认的完整行数组或列表行ID。'],
  failures: ['字段、权限、网络或响应形状错误原样抛出；不把删除警告当作后端成功。', '写请求超时先list核对，不自动重复创建或删除。'],
  evidence,
  gaps: ['未启动浏览器、未在真实测试环境执行读请求或prepare→submit→cancel写闭环；本契约来自固定源码和离线测试。', 'Portal/Java固定检出未按任务约束pull到远端最新，部署版本差异未验证。'],
  ...value,
})

const RAW: Record<string, AiContract> = {
  'inventory-organization-config-list': base({ purpose: '按法人单位筛选资产编码规则分页。', effect: 'read', inputs, output: listOutput, consume: ['按total分页；展示orgCode、orgName、creatorName、createTime；保留id用于删除。'], steps: [{ role: 'optional', when: '需要填写法人单位筛选或创建行', capabilityId: 'inventory-organization-config-corporations', mapping: {}, instruction: '展示候选name，提交选中的id。' }], completion: '返回当前筛选页和total。', idempotency: null }),
  'inventory-organization-config-corporations': base({ purpose: '读取资产编码页面使用的法人单位候选。', effect: 'read', inputs: {}, output: corporationsOutput, consume: ['把候选id填入list.orgId或create.rows[].orgId；不能提交name。'], steps: [], completion: '获得当前会话可见法人单位候选。', idempotency: null }),
  'inventory-organization-config-prepare-create': base({ purpose: '准备创建一批资产编码规则的本地草稿。', effect: 'prepare', inputs: rowsInput, output: createOutput, consume: ['逐行展示orgCode与法人名称，用户确认后交给create；取消时不发请求。'], steps: [{ role: 'required', when: '用户确认生成', capabilityId: 'inventory-organization-config-create', mapping: { rows: 'result.rows' }, instruction: '按原数组顺序提交。' }, { role: 'cancel', when: '用户取消弹窗', instruction: '丢弃草稿，不调用create。' }], completion: '获得无副作用创建草稿。', idempotency: null }),
  'inventory-organization-config-create': base({ purpose: '按Portal创建弹窗提交一批组织编码规则。', effect: 'write', inputs: rowsInput, output: voidOutput, consume: ['成功后按orgId与orgCode逐行查询确认；服务端没有新建ID回执。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'inventory-organization-config-list', mapping: {}, instruction: '用args.rows中的每个orgId和orgCode分页查找精确组合；不能因页面返回成功就跳过确认。' }], completion: '请求未抛错且列表回查确认每行。', idempotency: '后端无requestId；同样数组重试可能产生业务冲突或重复，超时先list核实。' }),
  'inventory-organization-config-prepare-remove': base({ purpose: '准备删除一条资产编码规则并等待用户确认。', effect: 'prepare', inputs: { id: input('资产编码规则ID', 'inventory-organization-config-list.list[].id', { type: 'string | number', constraints: idRules }) }, output: removeOutput, consume: ['展示所选列表行的组织编码与法人单位；取消时不调用remove。'], steps: [{ role: 'required', when: '用户确认删除', capabilityId: 'inventory-organization-config-remove', mapping: { id: 'result.id' }, instruction: '只提交同一列表行ID。' }, { role: 'cancel', when: '用户取消删除警告', instruction: '丢弃id草稿，不发DELETE。' }], completion: '获得无副作用删除草稿。', idempotency: null }),
  'inventory-organization-config-remove': base({ purpose: '删除一条资产编码规则。', effect: 'write', inputs: { id: input('资产编码规则ID', 'inventory-organization-config-prepare-remove.id', { type: 'string | number', constraints: idRules }) }, output: voidOutput, consume: ['按原orgId筛选重新查询确认该ID消失；删除后组织编码业务影响由Portal警告和后端规则决定。'], steps: [{ role: 'required', when: '请求完成或超时', capabilityId: 'inventory-organization-config-list', mapping: {}, instruction: '回查同一ID；找不到才报告删除已确认。' }], completion: '请求未抛错且列表回查确认。', idempotency: '删除无requestId且不可逆；超时先查询，不自动重放。' }),
}

export const INVENTORY_ORGANIZATION_CONFIG_AI_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.keys(INVENTORY_ORGANIZATION_CONFIG_METHODS).map(id => [id, RAW[id]!]))
export const INVENTORY_ORGANIZATION_CONFIG_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(Object.entries(INVENTORY_ORGANIZATION_CONFIG_METHODS).map(([id, method]) => [`inventoryOrganizationConfig.${method}`, INVENTORY_ORGANIZATION_CONFIG_AI_CONTRACTS[id]!]))
