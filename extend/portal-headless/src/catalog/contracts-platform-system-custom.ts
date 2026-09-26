import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { platformSystemCustomCapabilities } from '../capabilities/platform-system-custom.js'

const definitions = new Map(platformSystemCustomCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string): AiField => ({ path, type, meaning, optional: true, nullable: true })
const page = (fields: AiField[]): AiContract['output'] => ({
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页配置记录'), field('total', 'number', '符合范围的总记录数'), ...fields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[] 表示当前页没有记录；total=0 表示没有匹配项，不把空结果解释成权限结论。',
})
const object = (fields: AiField[]): AiContract['output'] => ({ shape: 'object', fields, empty: '字段缺省按空值处理；不要把空值猜成默认业务值。' })
const voidOutput: AiContract['output'] = { shape: 'undefined', fields: [], empty: '成功没有业务返回值；必须重新 list 核实写入结果。' }
const gaps = [
  '本轮已核对 Portal 页面源码、Java Controller/DTO、SDK 实现和离线请求断言；尚未在真实测试环境执行浏览器读操作。',
  '本轮未在真实环境执行创建/编辑的 prepare → submit → cancel/回滚记录；后端没有页面可达的撤销接口。',
]

function typeOf (kind: string): string {
  if (kind === 'number') return 'number'
  if (kind === 'text') return 'string'
  return 'string'
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Platform system custom contract has no definition: ${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: typeOf(parameter.kind),
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: '用户给出的系统配置查询或表单条件；类型和必填性按能力参数契约填写。',
  }]))
}

const contracts: Record<string, AiContract> = {}
function add (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Platform system custom contract has no definition: ${id}`)
  contracts[id] = {
    purpose,
    whenToUse: purpose,
    boundaries: [
      '只操作当前 Portal v2 系统配置权限下的数据；请求使用 platform 实例和 /mall-manage-api 前缀。该页面不发送 module-type。',
      '配置项 body 是页面本地编辑的 JSON 数组；行内新增、编辑、删除和取消不会独立请求，只有 create/update 才提交。',
    ],
    effect: definition.write ? 'write' : 'read',
    prerequisites: ['使用会话 token 和租户创建 SDK；编辑先确认列表返回的配置 ID。'],
    output,
    consume,
    steps: [],
    completion: '返回值符合本能力结构；写入能力还需重新查询列表核对 code、name、info 和解析后的 body。',
    failures: ['页面必填或 body JSON 校验失败时修正输入；写请求超时先 list 核实，不盲目重复创建。'],
    idempotency: null,
    evidence: [
      { source: 'src/capabilities/platform-system-custom.ts', kind: 'implementation', note: '核对分页参数、/mall-manage-api 请求前缀、表单校验和 body JSON 序列化。' },
      { source: 'test/platform-system-custom.test.ts', kind: 'test', note: '离线锁定权限、无 module-type、列表默认值、POST 路径和表单负例。' },
      { source: 'docs/pages/系统配置.md', kind: 'reference', note: '记录页面本地 body 行操作和 Java DTO 字段依据。' },
    ],
    gaps: [...gaps],
    ...extra,
    inputs: { ...inputsOf(id), ...extra.inputs },
  }
}

const rowFields = [
  field('id', 'string | number', '系统配置主键；保留长整数原始字符串'),
  field('code', 'string', '配置代码'),
  field('name', 'string', '配置名称'),
  field('body', 'string', '配置项 JSON 字符串；消费前解析为数组'),
  field('info', 'string | null', '配置说明'),
  field('modifiedTime', 'string | number | null', '更新时间原值'),
]
const payloadFields = [
  field('payload', 'object', '页面最终提交的配置请求体'),
  field('payload.id', 'string | number | ""', '创建为页面初始空字符串；更新为列表行 ID'),
  field('payload.code', 'string', '配置代码；页面必填'),
  field('payload.name', 'string', '配置名称；页面必填'),
  field('payload.info', 'string', '配置说明；缺省按空字符串提交'),
  field('payload.body', 'string', '规范化后的 JSON 数组字符串'),
]

add('platform-system-custom-list', '分页查询 Portal 系统配置列表。', page(rowFields), ['从 list[].id 选择编辑目标；body 是 JSON 字符串，先解析后消费其配置项。'])
add('platform-system-custom-prepare-create', '按页面规则校验创建表单并生成系统配置请求体，不发请求。', object(payloadFields), ['将 payload 交给 create；prepare 成功不代表服务端已经创建。'], { effect: 'prepare' })
add('platform-system-custom-create', '创建一条系统配置。', voidOutput, ['成功或超时后重新 list，按完整 code/name 核对记录及 body 内容。'], { idempotency: '后端保存没有 requestId 或撤销接口；超时必须先 list 核实，不能换 ID 或名称盲目重建。', steps: [{ capabilityId: 'platform-system-custom-list', role: 'required', when: '创建响应成功或不确定时', instruction: '重新查询列表，核对完整 code、name、info 和 body。' }] })
add('platform-system-custom-prepare-update', '按页面规则校验编辑表单并生成系统配置请求体，不发请求。', object(payloadFields), ['将 payload 交给 update；body 行内的保存/删除已体现在 payload.body 中。'], { effect: 'prepare' })
add('platform-system-custom-update', '编辑一条已有系统配置。', voidOutput, ['成功或超时后重新 list，按 id 核对完整字段和解析后的 body。'], { idempotency: '后端修改没有 requestId；更新是绝对值提交，超时先 list 读取当前记录后再判断是否重试。', steps: [{ capabilityId: 'platform-system-custom-list', role: 'required', when: '更新响应成功或不确定时', instruction: '重新查询列表，按 id 逐字段核对最终状态。' }] })

for (const id of ['platform-system-custom-prepare-create', 'platform-system-custom-create', 'platform-system-custom-prepare-update', 'platform-system-custom-update']) {
  contracts[id]!.inputs.form = {
    type: 'object',
    required: true,
    meaning: id.includes('update') ? '列表桥接后修改的系统配置表单；必须包含 id、code、name、info 和 body。' : '系统配置创建表单；必须包含 code、name，body 可为空数组。',
    source: 'Portal 表单字段；body 可传 JSON 数组或等价 JSON 字符串，SDK 会按页面规则重新序列化。',
  }
}

export const PLATFORM_SYSTEM_CUSTOM_AI_CONTRACTS = contracts
