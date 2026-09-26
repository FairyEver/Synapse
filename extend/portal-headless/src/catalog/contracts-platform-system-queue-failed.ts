import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { platformSystemQueueFailedCapabilities } from '../capabilities/platform-system-queue-failed.js'

const definitions = new Map(platformSystemQueueFailedCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string): AiField => ({ path, type, meaning, optional: true, nullable: true })
const page = (fields: AiField[]): AiContract['output'] => ({
  shape: '{ list: object[], total: number }',
  fields: [field('list', 'object[]', '当前页失败队列记录'), field('total', 'number', '符合 data 条件的总记录数'), ...fields.map(item => ({ ...item, path: `list[].${item.path}` }))],
  empty: 'list=[] 表示当前页没有记录；total=0 表示当前 data 条件没有失败队列，不把空结果解释成权限结论。',
})
const object = (fields: AiField[]): AiContract['output'] => ({ shape: 'object', fields, empty: '字段缺省或 null 时按空值处理，不把空值猜成默认业务值。' })
const voidOutput: AiContract['output'] = { shape: 'undefined', fields: [], empty: '成功没有业务返回值；删除后应 list 核实，执行后只能报告服务端已接受执行请求。' }
const gaps = [
  '本轮已核对 Portal 页面源码、Java Controller/DTO、SDK 实现和离线请求断言；尚未在真实测试环境执行浏览器读操作。',
  '本轮未在真实环境执行删除/手动执行的 prepare → submit → cancel/回滚记录；页面没有撤销接口，执行结果需部署环境冒烟后再移除该缺口。',
]

function typeOf (kind: string): string {
  if (kind === 'number') return 'number'
  return 'string'
}
function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Failed queue contract has no definition: ${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, {
    type: typeOf(parameter.kind), required: parameter.required,
    meaning: parameter.description ?? parameter.name,
    source: '用户给出的失败队列查询条件或选中 ID；类型和必填性按能力参数契约填写。',
  }]))
}
const contracts: Record<string, AiContract> = {}
function add (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Failed queue contract has no capability: ${id}`)
  contracts[id] = {
    purpose, whenToUse: purpose,
    boundaries: ['只操作当前 Portal 用户、当前租户和 /dashboard/platform-v2/system/regular/fail 权限范围内的失败队列；SDK 绑定 platform 实例且不发送 module-type。', '详情按钮只把当前列表行字段放入 URL query 展示，不是独立的后端详情读取能力。'],
    effect: definition.write ? 'write' : 'read',
    prerequisites: ['使用会话 token 和租户创建 SDK；删除或执行前先确认最新列表行 ID。'],
    output, consume, steps: [],
    completion: '返回值符合本能力结构；写操作按各自的独立核实边界解释结果。',
    failures: ['参数校验失败按页面输入修正；网络/权限失败不能以空列表代替。', '写请求超时先按原 ID 查询或由业务方确认执行状态，不能盲目重试有副作用的动作。'],
    idempotency: null,
    evidence: [
      { source: 'src/capabilities/platform-system-queue-failed.ts', kind: 'implementation', note: '核对 data 查询默认值、分页、批量 DELETE、手动执行 URL query 和本地详情边界。' },
      { source: 'test/platform-system-queue-failed.test.ts', kind: 'test', note: '离线锁定权限、无 module-type、请求参数、删除 body、run URL 和负例。' },
      { source: 'docs/pages/失败队列.md', kind: 'reference', note: '记录 Portal 页面动作和 Java Controller/DTO 字段依据。' },
    ],
    gaps: [...gaps], ...extra, inputs: { ...inputsOf(id), ...extra.inputs },
  }
}
const rowFields = [
  field('id', 'string | number', '失败队列主键；保留原始字符串避免长整数精度损失'),
  field('queueName', 'string | null', '队列标识'), field('data', 'string | null', '队列数据原文'),
  field('createTime', 'number | null', '创建/失败时间原始整数时间'), field('reason', 'string | null', '失败原因原文'),
]
const ids = { type: '(string | number)[]', required: true, meaning: '用户选中的失败队列 ID 数组；至少一项，不能传行号。', source: '来自 list[].id 的用户选中项。' } satisfies AiParameter
const id = { type: 'string | number', required: true, meaning: '用户选中的失败队列 ID；来自 list[].id。', source: '来自 list[].id 的用户选中项，不能按名称猜测。' } satisfies AiParameter

add('platform-system-queue-failed-list', '按队列数据关键字分页查询失败队列。', page(rowFields), ['展示 queueName、data、createTime 和 reason；需要完整范围时按 pageNo/pageSize 翻页至 total。'], { inputs: { data: { type: 'string', required: false, meaning: '队列数据筛选字符串；空字符串表示不过滤，保留用户输入，不自动 trim。', source: '用户给出的队列数据筛选条件。' } } })
add('platform-system-queue-failed-prepare-remove', '校验选中的失败队列 ID 并准备批量删除，不发请求。', object([field('ids', '(string | number)[]', '准备删除的 ID 数组')]), ['将 ids 交给 remove；prepare 成功不表示已经删除。'], { effect: 'prepare', inputs: { ids } })
add('platform-system-queue-failed-remove', '删除选中的失败队列记录。', voidOutput, ['成功或超时后按原 data 条件分页 list，确认所有目标 ID 不再出现。'], { idempotency: '后端没有 requestId 或撤销接口；超时先列表核实，不换 ID 集合盲目重试。', inputs: { ids }, steps: [{ capabilityId: 'platform-system-queue-failed-list', role: 'required', when: 'DELETE 成功或结果不确定时', instruction: '按原 data 条件分页查找所有目标 ID；全部明确消失才报告删除已核实。', mapping: {} }] })
add('platform-system-queue-failed-prepare-run', '校验手动执行失败队列的目标 ID，不发请求。', object([field('id', 'string | number', '准备执行的失败队列 ID')]), ['将 id 交给 run；prepare 成功不代表服务端已开始执行。'], { effect: 'prepare', inputs: { id } })
add('platform-system-queue-failed-run', '手动执行一条失败队列记录。', voidOutput, ['返回成功只表示后端接受了执行请求；页面没有执行状态字段或撤销接口，必要时由业务方重新 list 并结合后端任务结果核实。'], { idempotency: '手动执行没有 requestId；请求超时可能已经触发任务，先由业务方确认失败队列/任务状态，不立即重复执行。', inputs: { id } })

export const PLATFORM_SYSTEM_QUEUE_FAILED_AI_CONTRACTS = contracts
