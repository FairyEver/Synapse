import type { AiContract, AiField, AiParameter } from './ai-contract.js'
import { platformSystemScheduleCapabilities } from '../capabilities/platform-system-schedule.js'

const definitions = new Map(platformSystemScheduleCapabilities.map(definition => [definition.id, definition]))
const field = (path: string, type: string, meaning: string): AiField => ({ path, type, meaning, optional: true, nullable: true })
const page = (fields: AiField[]): AiContract['output'] => ({ shape: '{ list: object[], total: number }', fields: [field('list', 'object[]', '当前页定时任务'), field('total', 'number', '定时任务总数'), ...fields.map(item => ({ ...item, path: `list[].${item.path}` }))], empty: 'list=[] 表示当前页没有记录；total=0 表示没有定时任务，不把空结果解释成权限结论。' })
const object = (fields: AiField[]): AiContract['output'] => ({ shape: 'object', fields, empty: '字段缺省或 null 时按空值处理，不把空值猜成默认业务值。' })
const voidOutput: AiContract['output'] = { shape: 'undefined', fields: [], empty: '成功没有业务返回值；编辑后应重新 list 核对，执行动作只能说明服务端接受请求。' }
const gaps = ['本轮已核对 Portal 页面源码、Java Controller/DTO/Service、SDK 实现和离线请求断言；尚未在真实测试环境执行浏览器读操作。', '本轮未在真实环境执行编辑/执行的 prepare → submit → cancel/回滚记录；页面没有撤销接口，写入结果需部署环境冒烟后再移除该缺口。']
function typeOf (kind: string): string { return kind === 'number' ? 'number' : 'string' }
function inputsOf (id: string): Record<string, AiParameter> {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Schedule contract has no definition: ${id}`)
  return Object.fromEntries(definition.params.map(parameter => [parameter.name, { type: typeOf(parameter.kind), required: parameter.required, meaning: parameter.description ?? parameter.name, source: '用户给出的定时任务查询条件、编辑表单或选中 ID；类型和必填性按能力参数契约填写。' }]))
}
const contracts: Record<string, AiContract> = {}
function add (id: string, purpose: string, output: AiContract['output'], consume: string[], extra: Partial<AiContract> = {}): void {
  const definition = definitions.get(id)
  if (!definition) throw new Error(`Schedule contract has no capability: ${id}`)
  contracts[id] = { purpose, whenToUse: purpose, boundaries: ['只操作当前 Portal 用户、当前租户和 /dashboard/platform-v2/system/regular/task 权限范围内的定时任务；SDK 绑定 platform 实例且不发送 module-type。', '页面没有新建、删除、暂停/恢复入口；编辑页从列表行 bridge 加载，因此不发布不可达详情/创建/状态接口。'], effect: definition.write ? 'write' : 'read', prerequisites: ['使用会话 token 和租户创建 SDK；编辑或执行前确认最新列表行 ID。'], output, consume, steps: [], completion: '返回值符合本能力结构；编辑需回查列表，执行结果不夸大为任务业务已完成。', failures: ['参数校验失败按页面规则修正；编辑/执行超时先读取当前列表或由业务方确认，不盲目重试。', '权限或网络失败不能以空列表或成功文案代替。'], idempotency: null, evidence: [{ source: 'src/capabilities/platform-system-schedule.ts', kind: 'implementation', note: '核对未启用styleV2的pageSize=10、列表 bridge 编辑整表单、cron必填、POST update和run params。' }, { source: 'test/platform-system-schedule.test.ts', kind: 'test', note: '离线锁定权限、无 module-type、默认分页、整表单提交、状态规则、run 参数和负例。' }, { source: 'docs/pages/定时任务.md', kind: 'reference', note: '记录 Portal 列表/编辑源码和 Java DTO/Service 依据。' }], gaps: [...gaps], ...extra, inputs: { ...inputsOf(id), ...extra.inputs } }
}
const rowFields = [field('id', 'string | number', '定时任务主键；保留原始字符串避免长整数精度损失'), field('beanName', 'string | null', 'Spring Bean 名称'), field('params', 'string | null', '任务参数原文'), field('cronExpression', 'string | null', 'Cron 规则'), field('status', 'number | null', '任务状态，0=暂停，1=正常'), field('remark', 'string | null', '任务描述；页面空值展示为“无”'), field('createDate', 'string | number | null', '创建时间原值')]
const updateFields = [field('payload', 'object', '页面 bridge 表单完整提交体；保留未知字段'), field('payload.id', 'string | number', '被编辑的定时任务 ID'), field('payload.cronExpression', 'string', 'Cron 规则；页面唯一 required 字段，非空字符串'), field('payload.status', 'number | null', '启停状态；页面开关只能产生 0 或 1'), field('payload.beanName', 'string | null', 'Spring Bean 名称'), field('payload.params', 'string | null', '任务参数原文'), field('payload.remark', 'string | null', '任务描述')]
const form = { type: 'object', required: true, meaning: '列表行 bridge 后的完整编辑表单；必须包含 id 和非空 cronExpression，提交保留页面其它字段。', source: '来自 platform-system-schedule-list 的 list[] 记录及用户明确修改；不要只传差异字段。' } satisfies AiParameter
const id = { type: 'string | number', required: true, meaning: '用户选中的定时任务 ID；来自 list[].id。', source: '来自最新列表行，不按任务名称猜测。' } satisfies AiParameter
add('platform-system-schedule-list', '分页查询定时任务。', page(rowFields), ['展示 cronExpression、status、remark、beanName；需要完整范围时按 pageNo/pageSize 翻页至 total。'])
add('platform-system-schedule-prepare-update', '按页面规则准备编辑定时任务请求体，不发请求。', object(updateFields), ['把 payload 交给 update；prepare 成功不表示服务端已经保存。'], { effect: 'prepare', inputs: { form } })
add('platform-system-schedule-update', '编辑已有定时任务的 Cron 规则和启停状态。', voidOutput, ['成功或超时后重新 list，按 payload.id 核对 cronExpression、status、beanName、params 和 remark；页面提交是绝对值整表单，不是差异 PATCH。'], { idempotency: '后端没有 requestId 或撤销接口；超时先按同一 ID list 核对当前字段，再决定是否重试。', inputs: { form }, steps: [{ capabilityId: 'platform-system-schedule-list', role: 'required', when: 'POST update 成功或结果不确定时', instruction: '重新分页查找同一 payload.id，逐字段核对编辑后的状态；找不到或字段冲突都不能报告已核实。', mapping: {} }] })
add('platform-system-schedule-prepare-run', '校验手动执行定时任务的目标 ID，不发请求。', object([field('id', 'string | number', '准备执行的定时任务 ID')]), ['把 id 交给 run；prepare 成功不表示任务已经执行。'], { effect: 'prepare', inputs: { id } })
add('platform-system-schedule-run', '手动立即执行一个定时任务。', voidOutput, ['返回成功只表示服务端接受了执行请求；页面没有独立执行结果字段，不能据此报告任务业务已经完成。'], { idempotency: '手动执行没有 requestId；请求超时可能已经触发任务，先由业务方确认任务副作用，不立即重复执行。', inputs: { id } })
export const PLATFORM_SYSTEM_SCHEDULE_AI_CONTRACTS = contracts
