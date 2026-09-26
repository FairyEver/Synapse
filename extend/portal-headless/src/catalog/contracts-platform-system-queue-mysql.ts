import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { platformSystemQueueMysqlCapabilities } from '../capabilities/platform-system-queue-mysql.js'

const definitions = new Map(platformSystemQueueMysqlCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string): AiField => ({ path, type, meaning, optional: true, nullable: true })
const page = (fields: AiField[]): AiContract['output'] => ({ shape: '{ list: object[], total: number }', fields: [field('list', 'object[]', '当前页队列记录'), field('total', 'number', '队列记录总数'), ...fields.map(item => ({ ...item, path: `list[].${item.path}` }))], empty: 'list=[] 表示当前页没有记录；total=0 表示没有队列记录，不把空结果解释成权限结论。' })
const object = (fields: AiField[]): AiContract['output'] => ({ shape: 'object', fields, empty: '字段缺省或 null 时按空值处理，不把空值猜成默认业务值。' })
const voidOutput: AiContract['output'] = { shape: 'undefined', fields: [], empty: '成功没有业务返回值；删除后必须重新 list 核实 ID 不再出现。' }
const gaps = ['本轮已核对 Portal 页面源码、Java Controller/DTO、SDK 实现和离线请求断言；尚未在真实测试环境执行浏览器读操作。', '本轮未在真实环境执行删除的 prepare → submit → cancel/回滚记录；页面没有恢复/撤销接口，写入结果需部署环境冒烟后再移除该缺口。']
function typeOf (kind: string): string { return kind === 'number' ? 'number' : 'string' }
function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Queue management contract has no definition: ${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, { type: typeOf(parameter.kind), required: parameter.required, meaning: parameter.description ?? parameter.name, source: '用户给出的队列管理查询条件或选中 ID；类型和必填性按能力参数契约填写。' }]))
}
const contracts: Record<string, AiContract> = {}
function add (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Queue management contract has no capability: ${id}`)
  contracts[id] = { purpose, whenToUse: purpose, boundaries: ['只操作当前 Portal 用户、当前租户和 /dashboard/platform-v2/system/regular/queue 权限范围内的队列记录；SDK 绑定 platform 实例且不发送 module-type。', '页面只展示列表和批量删除；create/update/get 等后端接口不是当前页面可达动作。'], effect: definition.write ? 'write' : 'read', prerequisites: ['使用会话 token 和租户创建 SDK；删除前确认最新列表行 ID。'], output, consume, steps: [], completion: '返回值符合本能力结构；删除还需按后续步骤核实终态。', failures: ['参数校验失败按页面选择修正；写请求超时先 list 核实，不盲目重复删除。', '权限或网络错误不能用空列表代替。'], idempotency: null, evidence: [{ source: 'src/capabilities/platform-system-queue-mysql.ts', kind: 'implementation', note: '核对分页默认值、原始时间/线程字段、批量 DELETE body 和页面可达动作。' }, { source: 'test/platform-system-queue-mysql.test.ts', kind: 'test', note: '离线锁定权限、无 module-type、默认请求参数、删除 body 和负例。' }, { source: 'docs/pages/队列管理.md', kind: 'reference', note: '记录 Portal 页面动作和 Java Controller/DTO 字段依据。' }], gaps: [...gaps], ...extra, inputs: { ...inputsOf(id), ...extra.inputs } }
}
const rowFields = [field('id', 'string | number', '队列记录主键；保留原始字符串避免长整数精度损失'), field('queueName', 'string | null', '队列标识'), field('worker', 'string | null', '执行任务类'), field('params', 'string | null', '任务参数原文'), field('createTime', 'number | null', '进入队列时间原始整数时间'), field('lastConsumeTime', 'number | null', '任务开始执行时间原始整数时间'), field('ownerThreadId', 'number | null', 'MySQL 进程 ID'), field('attempts', 'number | null', '尝试执行次数')]
const ids = { type: '(string | number)[]', required: true, meaning: '用户选中的队列记录 ID 数组；至少一项，不能传行号。', source: '来自 list[].id 的用户选中项。' } satisfies AiParameter
add('platform-system-queue-mysql-list', '分页查询队列管理记录。', page(rowFields), ['展示 queueName、worker、createTime、lastConsumeTime 和 ownerThreadId；需要完整范围时按 pageNo/pageSize 翻页至 total。'])
add('platform-system-queue-mysql-prepare-remove', '校验选中的队列管理 ID 并准备批量删除，不发请求。', object([field('ids', '(string | number)[]', '准备删除的 ID 数组')]), ['将 ids 交给 remove；prepare 成功不表示已经删除。'], { effect: 'prepare', inputs: { ids } })
add('platform-system-queue-mysql-remove', '批量删除队列管理记录。', voidOutput, ['成功或超时后重新分页 list，确认所有 ids 都不再出现。'], { idempotency: '后端没有 requestId 或撤销接口；超时先按原 IDs 回查，未核实前不盲目重试。', inputs: { ids }, steps: [{ capabilityId: 'platform-system-queue-mysql-list', role: 'required', when: 'DELETE 成功或结果不确定时', instruction: '分页查找所有原 ids；全部明确消失才报告删除已核实。', mapping: {} }] })
export const PLATFORM_SYSTEM_QUEUE_MYSQL_AI_CONTRACTS = contracts
