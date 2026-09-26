/**
 * 评测执行器。
 *
 * 跑法：
 *   node tools/eval/run.mjs            # 全跑，打印报告
 *   node tools/eval/run.mjs T2         # 只跑 id 前缀匹配的任务
 *   node tools/eval/run.mjs --json     # 机器可读
 *   node tools/eval/run.mjs --trace    # 带上作答过程（调了什么、看到什么）
 *
 * 数据流：tasks.mjs（期望）+ answers.mjs（作答）→ consumer-view.mjs（调用方视角）
 *        → scoring.mjs（判分）→ 本文件（呈现）
 *
 * 接模型时：把 answers.mjs 换成模型产出的同构 JSON 即可，其余不动。
 */

import { TASKS } from './tasks.mjs'
import { ANSWERS } from './answers.mjs'
import { consumerView, INTERNAL_KEYS } from './consumer-view.mjs'
import { scoreRun } from './scoring.mjs'

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const withTrace = args.includes('--trace')
const filters = args.filter((a) => !a.startsWith('--'))

const tasks = filters.length
  ? TASKS.filter((t) => filters.some((f) => t.id.toLowerCase().startsWith(f.toLowerCase())))
  : TASKS

if (tasks.length === 0) {
  console.error(`没有匹配的任务。已知：${TASKS.map((t) => t.id).join('、')}`)
  process.exit(2)
}

// 一次建立「调用方视角」，同时拿到已注册能力清单（判分要用）
const views = {}
let registeredCapabilityIds = []
for (const task of tasks) {
  const view = await consumerView(task.utterance)
  views[task.id] = view
  if (view.registeredCapabilityIds.length) registeredCapabilityIds = view.registeredCapabilityIds
}

// 作答文件是 { decision, trace } 的信封；判分层只吃 decision，
// 这样换成模型直接吐的 decision JSON 也不用改编排。
const decisions = Object.fromEntries(tasks.map((t) => [t.id, ANSWERS[t.id]?.decision]))
const run = scoreRun(tasks, decisions, { registeredCapabilityIds })

if (asJson) {
  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        registeredCapabilityIds,
        summary: { total: run.total, passed: run.passed, failed: run.failed },
        results: run.results.map((r) => ({ ...r, trace: ANSWERS[r.taskId]?.trace ?? [] })),
      },
      null,
      1,
    ),
  )
  process.exit(run.failed === 0 ? 0 : 1)
}

const line = (s = '') => console.log(s)
line('='.repeat(72))
line(`portal-headless · AI 消费 -llm 协议 黑盒评测`)
line(`任务 ${run.total} 个 · 通过 ${run.passed} · 未过 ${run.failed}`)
line(`目录已注册能力 ${registeredCapabilityIds.length} 个：${registeredCapabilityIds.join('、')}`)
line('='.repeat(72))

for (const r of run.results) {
  const task = tasks.find((t) => t.id === r.taskId)
  const decision = ANSWERS[r.taskId]?.decision
  line()
  line(`${r.passed ? 'PASS' : 'FAIL'}  ${r.taskId}  [${r.kind}]`)
  line(`  用户原话：${task.utterance}`)
  line(`  作答：outcome=${decision?.outcome ?? '(无)'}${decision?.capabilityId ? ` → ${decision.capabilityId}` : ''}`)
  if (decision?.missing?.length) line(`  要问用户：${decision.missing.join('、')}`)
  if (decision?.pageRef) line(`  命中页面：${decision.pageRef}`)
  if (decision?.args && Object.keys(decision.args).length) {
    line('  参数：')
    for (const [k, spec] of Object.entries(decision.args)) {
      line(`    ${k} = ${JSON.stringify(spec.value)}${spec.deferred ? ' [需真调]' : ''}   ← ${spec.from}`)
    }
  }
  line('  判分：')
  for (const c of r.checks) line(`    ${c.ok ? '·' : '×'} ${c.name.padEnd(26)} ${c.detail}`)

  if (withTrace) {
    line('  过程：')
    for (const s of ANSWERS[r.taskId]?.trace ?? []) {
      line(`    → ${s.call}`)
      line(`      看到：${s.saw}`)
    }
  }
}

line()
line('-'.repeat(72))
line(`通过 ${run.passed}/${run.total}`)
if (run.failed) {
  line(`未过：${run.results.filter((r) => !r.passed).map((r) => r.taskId).join('、')}`)
}
line()
line(`（consumer-view 已剥掉 ${INTERNAL_KEYS.length} 个内部字段：${INTERNAL_KEYS.join('、')}）`)

process.exit(run.failed === 0 ? 0 : 1)
