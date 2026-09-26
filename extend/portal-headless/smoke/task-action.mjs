#!/usr/bin/env node
/**
 * 冒烟：**以审批人的身份办理待办**（`task-action` 这条横切能力）。
 *
 * ```bash
 * # 只读侦察（默认）：我是谁 / 我的待办分布 / 自审规则生不生效 / 五个流程的 BPMN 结构 /
 * #                 办理页的读链路（getWorkflowPath + myRunningTasks）
 * smoke/with-portal-token.sh node smoke/task-action.mjs
 *
 * # 写链路的**形状**探测（零副作用）：拿一个不存在的 task id 去打每一个写接口
 * smoke/with-portal-token.sh node smoke/task-action.mjs --probe-write
 * ```
 *
 * ## ⚠️ 为什么这里**没有**「真的办一条待办」的模式
 *
 * 办理 = 以**我自己的账号**去动**别人提交的**单据，所以本脚本只碰「我制造的测试数据」。
 * 而「造一条留给自己办的待办」这件事，本轮在三个层面证明了**用单一账号做不到**：
 *
 * **① 源码**：`BpmTaskServiceImpl.validateTask()`（`:876-883`）要求
 *    `task.assignee == 登录用户`，`/bpm/task/*` 的每个动作都先过它——别人的待办动不了。
 *    `BpmTaskEventListener.taskCreated()`（`:85-94`）的两条分支**都会**走到
 *    `tryAutoApproveWhenStartUserIsAssignee()`：`startUserId == assignee` 就当场自动通过。
 *    唯一的逃生口 `BPM_SKIP_AUTO_APPROVE_TASK_DEFINITION_KEY` 是**流程变量**，
 *    而五个流程的 `startBpmProcess()` 各自 `new HashMap<>()` / 服务端 builder 构造，
 *    全仓 `.setVariables(` 没有一处吃调用方给的 map ⇒ 客户端注入不进去。
 *
 * **② 运行时（本脚本第 2.6 节实测）**：翻「我的流程」最近 3 页里**没被取消**的 47 个实例，
 *    命中 22 条 `reason` 含「自动审核通过」的任务记录，其中一条正是
 *    `hr_general_approval` 的 `发起人自选2`、`assignee` = 本账号
 *    —— 即「自己提交 + 审批人填自己」在被秒批，**实测复现**。
 *
 * **③ 后果**：秒批后流程进终态，`cancel-by-start-user` 必然报「流程不处于运行中」，
 *    那条单据就永远撤不掉。测试环境里已经有 3 条这样的遗留，**不能再来一条**。
 *
 * ⇒ 唯一的解法是**第二个测试账号**（用它发起、审批人填本账号）。拿不到，
 *   所以写链路**没有端到端跑过**——`--probe-write` 只证明路由与字段名对得上，
 *   **不证明办理成功**。别把这两件事读成一件。
 *
 * ## 安全约束（本脚本自己执行）
 *
 * - **绝不办理任何待办**：本脚本没有「真的办理」这个模式。
 * - `--probe-write` **只用一个随机生成、必然不存在的 task id**（`sdk-test-<uuid>`）。
 *   后端在 `validateTask()` 那一步就抛错，**不可能有任何副作用**。
 * - 只读部分会读**我的待办列表**与**我自己发起**的实例；**不打印审批内容、不打印任何姓名**
 *   ——别人的单据内容不进日志。
 */

import { randomUUID } from 'node:crypto'

import { createPortalHeadless } from '../dist/index.js'
import {
  TASK_ACTION_BATCH_PAGE_PATH,
  TASK_ACTION_DETAIL_PAGE_PATH,
  createTaskActionCapability,
} from '../src/capabilities/task-action.ts'
import {
  BACKLOG_TASK_EXAMINE_PAGE_PATH,
  createBacklogTaskExamineCapability,
} from '../src/capabilities/backlog-task-examine.ts'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法：smoke/with-portal-token.sh node smoke/task-action.mjs [--probe-write]\n',
  )
  process.exit(1)
}

const line = (text = '') => process.stdout.write(`${text}\n`)
const step = (n, text) => line(`\n[${n}] ${text}`)
const probeWrite = process.argv.includes('--probe-write')

const sdk = createPortalHeadless({ baseUrl, credential: { token, tenantId } })

/** 组装点还没接线，所以自己造一份；两页各给一个请求函数，走同一条 `sdk.call(pagePath, config)` */
const capability = createTaskActionCapability(
  (config) => sdk.call(TASK_ACTION_DETAIL_PAGE_PATH, config),
  (config) => sdk.call(TASK_ACTION_BATCH_PAGE_PATH, config),
)

/** 待办列表那条线（只读）已经做完了，复用它的「找到要办哪条待办」 */
const backlog = createBacklogTaskExamineCapability((config) =>
  sdk.call(BACKLOG_TASK_EXAMINE_PAGE_PATH, config),
)

/** 流程定义（只读）。通用审批那条线声明为能力，这里直接用它的接口 */
const definition = (key) =>
  sdk.call(TASK_ACTION_DETAIL_PAGE_PATH, { url: '/bpm/process-definition/get', method: 'get', params: { key } })

/** 五个 SDK 流程线 + 会议室（已做的那条），用来读 BPMN 的 userTask 结构 */
const PROCESS_KEYS = [
  'hr_general_approval',
  'qingjia',
  'vehicle_usage_application',
  'hr_product_design_approval',
  'internal_transportation_expense_request_form',
  'meeting_application',
]

/** 从 bpmnXml 里抠出 userTask 的 id / name / candidateStrategy */
function userTasks (bpmnXml) {
  const out = []
  const re = /<(?:\w+:)?userTask\b[^>]*>/g
  let match
  while ((match = re.exec(String(bpmnXml ?? ''))) !== null) {
    const tag = match[0]
    const attr = (name) => {
      const m = tag.match(new RegExp(`${name.replace(':', '\\:')}="([^"]*)"`))
      return m ? m[1] : null
    }
    out.push({
      id: attr('id'),
      name: attr('name'),
      candidateStrategy: attr('flowable:candidateStrategy'),
      candidateParam: attr('flowable:candidateParam'),
    })
  }
  return out
}

/** 把异常里的业务信息抠出来（后端业务冲突是 HTTP 200 + code 500，只有 msg 有用） */
function describeError (error) {
  const parts = [`${error?.name || 'Error'}: ${error?.message || String(error)}`]
  for (const key of ['code', 'ret', 'msg']) {
    if (error?.[key] !== undefined) parts.push(`${key}=${JSON.stringify(error[key])}`)
  }
  return parts.join(' ')
}

try {
  line(`环境 ${baseUrl}，模式：${probeWrite ? '只读 + 写形状探测' : '只读'}`)
  line(`能力来源：${sdk.taskAction ? 'sdk.taskAction（组装点已接线）' : 'createTaskActionCapability + sdk.call（组装点尚未接线）'}`)

  // ---- 1. 我是谁 ----
  step(1, '我是谁（只读）GET /bpm/process-instance/my-page')
  const me = await capability.currentUserId()
  line(`    当前登录用户 id=${me ?? '<推不出来>'}（来源：最近一条「我的流程」的 startUser.id）`)
  if (me === undefined) line('    ⚠️ 「我的流程」一条都没有，推不出身份；下面需要身份的判断会失真。')

  // ---- 2. 我的待办 ----
  step(2, '我的待办有多少条（只读）——**只看数量与流程 key，不打印内容与姓名**')
  const todo = await backlog.list({ finished: 1, pageSize: 100 })
  line(`    finished=1 共 ${todo.total} 条，本页取到 ${todo.list.length} 条`)
  const byKey = new Map()
  for (const row of todo.list) {
    const key = row?.processInstance?.processDefinitionKey ?? '<无 key>'
    byKey.set(key, (byKey.get(key) ?? 0) + 1)
  }
  line(`    按流程分布：${[...byKey.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`)

  const mine = todo.list.filter((row) => String(row?.processInstance?.startUserId) === String(me))
  line(`    我的待办里、**流程是我自己发起**的：${mine.length} 条（` +
    '这一条是「能不能只靠自己造出一条留给自己办的待办」的入口）')
  line('    ⚠️ 无论是不是我发起的，那都是**真实单据**（自己发起 ≠ 测试数据）。本脚本一条都不会办理。')

  // ---- 2.5 办理页的读链路：在一台**我自己的、还在跑的**实例上跑一遍 ----
  step('2.5', '办理页的读链路（只读）：instance → workflowPath → myRunningTasks')
  const explicitInstanceId = process.env.PORTAL_SMOKE_INSTANCE_ID
  // 默认取「待办列表里、流程由我发起」的第一条（列表按发起时间倒序）。
  // ⚠️ 它是**真实单据**，所以下面只打印 BPMN 节点名与状态，不打印任何单据内容。
  const candidateRow =
    explicitInstanceId !== undefined
      ? { processInstance: { id: explicitInstanceId } }
      : mine[0]
  if (!candidateRow) {
    line('    跳过：待办里没有「我发起 + 审批中」的实例，也没给 PORTAL_SMOKE_INSTANCE_ID')
  } else {
    const instanceId = candidateRow.processInstance.id
    const instance = await capability.instance(instanceId)
    line(`    instance id=${instanceId} key=${instance?.processDefinition?.key} status=${instance?.status}`)
    line(`    发起人是不是我：${String(instance?.startUser?.id) === String(me)}`)
    line(`    formFields=${JSON.stringify(instance?.formFields ?? null)} ← 恒为 null（流程实例里没有表单字段）`)
    const all = await capability.workflowPath(instanceId)
    line(`    workflowPath 展平后 ${all.length} 个节点（含加签的 children）：`)
    for (const task of all) {
      // 只打印**节点名 / 状态 / 处理人 id**——节点名是 BPMN 里的，不含单据内容
      line(
        `      - id=${task.id} name=${JSON.stringify(task.name)} status=${task.status} ` +
          `assignee=${task.assigneeUser?.id ?? '<null>'}`,
      )
    }
    const running = await capability.myRunningTasks(instanceId, me)
    line(`    myRunningTasks（页面 loadRunningTask 的三条判据）→ ${running.length} 个该我办：`)
    for (const task of running) line(`      - id=${task.id} name=${JSON.stringify(task.name)} status=${task.status}`)
    line('    ⚠️ 这才只是「找到了」，**没有办理**——下一节解释为什么办不了。')
  }

  // ---- 2.6 自审规则在这套环境上到底生不生效 ----
  step('2.6', '自审规则生效过吗？（只读）翻「我的流程」最近 3 页里**没被取消**的实例')
  line('    ⚠️ 必须排除已取消（status=4）的实例：取消的实例任务已被删，查也是空——那是最典型的假绿样本')
  let scanned = 0
  let skippedCancelled = 0
  let autoApproveSeen = 0
  const autoSamples = []
  for (let page = 1; page <= 3; page += 1) {
    const pageData = await sdk.call(TASK_ACTION_DETAIL_PAGE_PATH, {
      url: '/bpm/process-instance/my-page',
      method: 'get',
      params: { order: '', orderField: '', name: '', title: '', category: '', pageNo: page, pageSize: 20 },
    })
    const rows = pageData?.list ?? []
    if (rows.length === 0) break
    for (const row of rows) {
      if (row.status === 4) {
        skippedCancelled += 1
        continue
      }
      scanned += 1
      let tasks = []
      try {
        tasks = await capability.workflowPath(row.id)
      } catch {
        continue
      }
      for (const task of tasks) {
        if (/自动审核通过/.test(String(task.reason ?? ''))) {
          autoApproveSeen += 1
          if (autoSamples.length < 6) {
            autoSamples.push(
              `      ★ key=${row.processDefinitionKey} task=${JSON.stringify(task.name)} ` +
                `status=${task.status} assignee=${task.assigneeUser?.id ?? '<null>'} reason=${JSON.stringify(task.reason)}`,
            )
          }
        }
      }
    }
  }
  for (const sample of autoSamples) line(sample)
  line(`  有效样本 ${scanned} 个实例（另跳过 ${skippedCancelled} 个已取消）`)
  line(`  「自动审核通过」命中：${autoApproveSeen} 条`)
  line('  ⇒ >0（本轮实测就是 >0）说明「自己提交 + 审批人填自己」会被**当场秒批**，')
  line('    流程进终态、单据撤不掉。这条就是本单不做端到端写验证的原因。')

  // ---- 3. 五个流程的 userTask 结构 ----
  step(3, '五个 SDK 流程线的 BPMN userTask 结构（只读）GET /bpm/process-definition/get?key=')
  line('    candidateStrategy=35 是「发起人自选」（发起时人工指定）；其余是后端按角色/岗位算')
  for (const key of PROCESS_KEYS) {
    try {
      const def = await definition(key)
      const tasks = userTasks(def.bpmnXml)
      line(`  ${key}（${def.name}）userTask ${tasks.length} 个`)
      for (const task of tasks) {
        line(
          `      - id=${task.id} name=${JSON.stringify(task.name)} ` +
            `candidateStrategy=${task.candidateStrategy ?? '-'} candidateParam=${task.candidateParam ?? '-'}`,
        )
      }
      if (tasks.length === 0) line('      （没有 userTask ⇒ 这条流程不会产生待办，也就没有「办理」这一步）')
    } catch (error) {
      line(`  ${key} → ✗ ${String(error?.message).slice(0, 120)}`)
    }
  }

  if (!probeWrite) {
    step('完', '只读模式到此为止：没有办理任何待办、没有写任何东西。')
    line('（写链路的形状探测：加 --probe-write；它用一个**不存在的** task id，零副作用）')
    process.exit(0)
  }

  // ---- 4. 写形状探测：**不存在的 task id**，后端在 validateTask() 就抛，零副作用 ----
  step(4, '★ 写形状探测（--probe-write）—— 每一条都打一个**必然不存在**的 task id')
  const bogusTaskId = `sdk-test-does-not-exist-${randomUUID()}`
  const bogusTaskIds = [bogusTaskId]
  line(`    task id = ${bogusTaskId}`)
  line('    判据：后端必须回**任务级**的错（「该任务不存在」/「任务不处于未审批」），')
  line('          **不能**回参数级的错（「任务编号不能为空」「审批意见不能为空」）。')
  line('          回参数级 = SDK 的字段名没被后端读到（那就是真 bug）；')
  line('          回任务级 = 路由、HTTP 方法、body 字段映射全对（但**不代表办理会成功**）。')
  line('')

  const probes = [
    ['approve', () => capability.approve({ taskId: bogusTaskId, reason: 'SDK-TEST-写形状探测', copyUserIds: [] }), 'PUT /bpm/task/approve'],
    ['reject', () => capability.reject({ taskId: bogusTaskId, reason: 'SDK-TEST-写形状探测' }), 'PUT /bpm/task/reject'],
    ['transfer', () => capability.transfer({ taskId: bogusTaskId, assigneeUserId: 1, reason: 'SDK-TEST-写形状探测' }), 'PUT /bpm/task/transfer'],
    ['delegate', () => capability.delegate({ taskId: bogusTaskId, delegateUserId: 1, reason: 'SDK-TEST-写形状探测' }), 'PUT /bpm/task/delegate'],
    ['return', () => capability.returnTask({ taskId: bogusTaskId, targetTaskDefinitionKey: 'Activity_1o1sabd', reason: 'SDK-TEST-写形状探测' }), 'PUT /bpm/task/return'],
    ['returnOptions', () => capability.returnOptions(bogusTaskId), 'GET /bpm/task/list-by-return'],
    ['batchApprove', () => capability.batchApprove({ taskIds: bogusTaskIds, reason: 'SDK-TEST-写形状探测' }), 'PUT /bpm/task/batchApprove'],
    ['batchReject', () => capability.batchReject({ taskIds: bogusTaskIds, reason: 'SDK-TEST-写形状探测' }), 'PUT /bpm/task/batchReject'],
  ]

  const PARAM_LEVEL = /不能为空|参数|校验失败|MethodArgumentNotValid|Bad Request|400/
  let paramLevelErrors = 0
  for (const [name, run, route] of probes) {
    line(`  ${name.padEnd(14)} ${route}`)
    try {
      const result = await run()
      line(`      ⚠️ 竟然成功了？返回 ${JSON.stringify(result)} —— 那个 task id 不可能存在，请立刻人工核查`)
      paramLevelErrors += 1
    } catch (error) {
      const text = describeError(error)
      const isParamLevel = PARAM_LEVEL.test(text)
      if (isParamLevel) paramLevelErrors += 1
      line(`      ${isParamLevel ? '✗ 参数级错误（字段名没被读到！）' : '✓ 任务级错误'} → ${text.slice(0, 200)}`)
    }
  }
  line('')
  line(`  参数级错误 / 意外成功：${paramLevelErrors} 条（期望 0）`)
  line('  ⚠️ 仍未验证的：**办理成功**这件事本身。它需要一条真的分配给我的待办——见文件头。')

  step('完', probeWrite ? '写形状探测结束：没有办理任何待办、没有改变任何数据。' : '只读结束。')
} catch (error) {
  process.stderr.write(`\n失败：${describeError(error)}\n`)
  if (error?.stack) process.stderr.write(`${error.stack.split('\n').slice(1, 4).join('\n')}\n`)
  process.exit(1)
}
