import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { platformSystemQueueExportCapabilities } from '../capabilities/platform-system-queue-export.js'

const definitions = new Map(platformSystemQueueExportCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string): AiField => ({ path, type, meaning, optional: true, nullable: true })
const page = (fields: AiField[]): AiContract['output'] => ({
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页导出队列记录'), field('total', 'number', '符合 type=export 的总记录数'), ...fields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[] 表示当前页没有记录；total=0 表示没有导出队列记录，不把空结果解释成权限结论。',
})
const object = (fields: AiField[]): AiContract['output'] => ({ shape: 'object', fields, empty: '字段缺省或 null 时按空值处理，不把空值猜成默认业务值。' })
const voidOutput: AiContract['output'] = { shape: 'undefined', fields: [], empty: '成功没有业务返回值；删除后必须重新 list 核实 ID 不再出现。' }
const gaps = [
  '本轮已核对 Portal 页面源码、Java Controller/DTO、SDK 实现和离线请求断言；尚未在真实测试环境执行浏览器读操作。',
  '本轮未在真实环境执行删除的 prepare → submit → cancel/回滚记录；该页面没有恢复/撤销接口，写入结果需部署环境冒烟后再移除该缺口。',
]

function typeOf (kind: string): string {
  if (kind === 'number') return 'number'
  return 'string'
}

function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Export queue contract has no definition: ${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: typeOf(parameter.kind),
    required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: '用户给出的导出队列查询条件或选中 ID；类型和必填性按能力参数契约填写。',
  }]))
}

const contracts: Record<string, AiContract> = {}
function add (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Export queue contract has no capability: ${id}`)
  contracts[id] = {
    purpose,
    whenToUse: purpose,
    boundaries: ['只操作当前 Portal 用户、当前租户和 /dashboard/platform-v2/system/queue/export 权限范围内的导出队列；SDK 绑定 platform 实例且不发送 module-type。', '页面固定 type=export；不要把其它队列类型的记录或 ID 混入本能力。'],
    effect: definition.write ? 'write' : 'read',
    prerequisites: ['使用会话 token 和租户创建 SDK；删除前先确认用户选中的完整记录 ID。'],
    output,
    consume,
    steps: [],
    completion: '返回值符合本能力结构；删除还需按后续步骤重新查询确认终态。',
    failures: ['参数校验失败按页面选择规则修正；写请求超时先 list 核实，不盲目重复删除。', '权限、会话或业务错误按原错误处理，不能用空列表代替失败。'],
    idempotency: null,
    evidence: [
      { source: 'src/capabilities/platform-system-queue-export.ts', kind: 'implementation', note: '核对固定 type=export、styleV2 分页默认值、批量 DELETE body 和字段归一化。' },
      { source: 'test/platform-system-queue-export.test.ts', kind: 'test', note: '离线锁定权限、无 module-type、默认请求参数、删除 ID body 和负例。' },
      { source: 'docs/pages/导出队列.md', kind: 'reference', note: '记录 Portal 页面动作和 Java Controller/DTO 字段依据。' },
    ],
    gaps: [...gaps],
    ...extra,
    inputs: { ...inputsOf(id), ...extra.inputs },
  }
}

const rowFields = [
  field('id', 'string | number', '导出任务主键；保留长整数原始字符串'),
  field('name', 'string | null', '任务名称'),
  field('message', 'string | null', '任务备注'),
  field('fileType', 'string | null', '文件类型'),
  field('createDateString', 'string | null', '创建时间展示文本'),
  field('completeDateString', 'string | null', '完成时间展示文本'),
  field('statusString', 'string | null', '任务状态展示文本'),
  field('key', 'string | null', '存储文件名称'),
  field('createDate', 'number | null', '创建时间原始整数时间'),
  field('completeDate', 'number | null', '完成时间原始整数时间'),
  field('status', 'number | null', '任务状态原值'),
  field('type', 'string | null', '队列类型；本页面固定为 export'),
  field('isDisplay', 'string | null', '是否展示原值'),
]
const deleteFields = [field('ids', '(string | number)[]', '准备删除的导出任务 ID 数组；至少一项')]

add('platform-system-queue-export-list', '分页查询导出队列。', page(rowFields), ['展示 list[].name、message、fileType、createDateString、completeDateString、statusString 和 key；按 pageNo/pageSize 翻页至 total。'])
add('platform-system-queue-export-prepare-remove', '校验选中的导出队列 ID 并准备批量删除，不发请求。', object(deleteFields), ['将 ids 交给 platform-system-queue-export-remove；prepare 成功不表示记录已经删除。'], { effect: 'prepare', inputs: { ids: { type: '(string | number)[]', required: true, meaning: '用户在当前或已保留选择中的导出队列 ID；不可传行号，至少一项。', source: '来自 list[].id 的用户选中项。' } } })
add('platform-system-queue-export-remove', '批量删除选中的导出队列记录。', voidOutput, ['成功或超时后重新 list，逐页确认每个 ids 中的 ID 都不再出现；权限/网络失败不能当作已删除。'], {
  idempotency: '后端没有 requestId 或撤销接口；超时先按原 IDs 分页回查，未确认前不换集合盲目重试。',
  inputs: { ids: { type: '(string | number)[]', required: true, meaning: '用户确认删除的导出任务 ID 数组；SDK以 JSON 数组发送，至少一项。', source: '来自 list[].id 的用户选中项，不能使用名称或页内下标。' } },
  steps: [{ capabilityId: 'platform-system-queue-export-list', role: 'required', when: 'DELETE 成功或结果不确定时', instruction: '重新分页查询并查找原 ids；只有全部明确消失才报告删除已核实。', mapping: {} }],
})

export const PLATFORM_SYSTEM_QUEUE_EXPORT_AI_CONTRACTS = contracts
