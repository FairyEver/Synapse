#!/usr/bin/env node
/**
 * 冒烟：用车申请（`vehicle_usage_application`）在真实测试环境上的完整链路。
 *
 * 两种模式：
 *
 * ```bash
 * # 只读（默认）：定义 / 组织范围 / 申请人候选 / 审批人候选 / prepare，一个字节都不写
 * smoke/with-portal-token.sh node smoke/vehicle-application.mjs
 *
 * # 完整链路：多跑 submit → 独立证实 → cancel → 再证实
 * smoke/with-portal-token.sh node smoke/vehicle-application.mjs --submit
 * ```
 *
 * ## ⚠️ `--submit` 会**真的给真人推待办**
 *
 * 用户 2026-09-21 的授权原文：「**允许在测试环境提交，接受打扰真人。**」
 * 但授权不是"随便提交"，脚本按下面几条自我约束：
 *
 * 1. **事由与目的地强制带 `SDK-TEST-` 前缀**（`assertTestData()`），不满足当场退出。
 *    用车表单**没有标题字段**（`instanceName` 是后端拼的 `staffName + "-用车审批"`），
 *    所以事由是收到待办的人唯一能看出这是测试数据的地方。
 * 2. ★ **审批人绝对不能选发起人本人。** 后端有一条
 *    「流程发起人与审批人相同，自动审核通过」（`BpmTaskServiceImpl`）：
 *    发起人一旦是某个节点的审批人，**那个节点当场通过**；本流程有 **3 个**自选节点，
 *    三个全中时整条流程在 `create` 返回之前就走完，`cancel-by-start-user` 必然报
 *    「流程不处于运行中」——**会永久留下一条撤不掉的单据**。
 *    （测试环境里已经有 3 条这样的遗留单据，不要再增加。）
 *    这条由**提交之前**的一次 `assertApproversNotSelf()` 拒绝，用的是能力里导出的同一个纯函数。
 * 3. **三个节点都指向同一个人**（默认 15012 乔娜）：BPMN 是**串行**的
 *    （`开始 → 自选 → 自选 → 自选 → 结束`，没有网关），后面的节点要等前一个办完
 *    才创建任务。所以**实际只会产生 1 条待办**、只打扰 1 个人，而不是 3 个。
 *    每个节点仍然各给 1 个 assignee（`minSelectCount = maxSelectCount = 1`，不能多也不能少）。
 * 4. **提交成功后一定会尝试撤销**（`finally` 里）：`submit` 成功的分支上，无论后面哪步炸了
 *    都会去 `cancel`。
 * 5. **绝不碰别人的单据**：只操作本脚本自己刚建的那一条（按 submit 返回的 businessKey
 *    找流程实例，找不到就报错，不会"顺手取消列表里的第一条"）。
 * 6. 只读模式下**不会**发任何写请求，也不会在 OSS 上留任何东西（本表单没有附件控件）。
 *
 * ## 为什么这个脚本直接 import `src/` 下的 .ts
 *
 * 它做两件事：拿 HTTP 管道（`createPortalHeadless`）与拿能力实现。
 *
 * - **管道**取自 `dist/index.js`（已构建产物）。
 * - **能力实现**取自 `../src/capabilities/vehicle-application.ts`——Node 22 的类型剥离
 *   直接认它。⚠️ 前提是这个文件**只 import type**，不能 import 别的能力模块的**值**：
 *   Node 的类型剥离**不会**把 `./x.js` 改写成 `./x.ts`（实测
 *   `ERR_MODULE_NOT_FOUND: .../general-approval.js`）。所以 `assertAssigneesForTasks`
 *   在能力文件里有一份本地复刻 —— 那条约束的由来写在能力文件头的导入注释里。
 *
 * ## 环境变量
 *
 * 必需（`smoke/with-portal-token.sh` 自动注入）：
 *   PORTAL_BASE_URL / PORTAL_TOKEN / PORTAL_TENANT_ID
 *
 * 可选（调参；名字不进仓库）：
 *   PORTAL_SMOKE_VEHICLE_APPROVER       审批人 **userId**（默认 15012）
 *   PORTAL_SMOKE_VEHICLE_APPROVER_NAME  它的姓名，用来在候选搜索里核对（默认 乔娜）
 *   PORTAL_SMOKE_VEHICLE_REASON         用车事由（默认自动生成，带 SDK-TEST- 前缀）
 *   PORTAL_SMOKE_VEHICLE_DESTINATION    用车目的地（默认自动生成）
 */

const env = process.env

// ---------------------------------------------------------------------------
// 闸先跑，import 放在后面 —— 见 smoke/upload.mjs 里的同一段理由：
// 静态 import 会在任何一行代码之前求值，环境不完整时守卫反而一行都不执行。
// ---------------------------------------------------------------------------

const missing = Object.entries({
  PORTAL_BASE_URL: env.PORTAL_BASE_URL,
  PORTAL_TOKEN: env.PORTAL_TOKEN,
  PORTAL_TENANT_ID: env.PORTAL_TENANT_ID,
}).filter(([, value]) => !value).map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法（推荐，token 由脚本自己取）：\n' +
      '  smoke/with-portal-token.sh node smoke/vehicle-application.mjs [--submit]\n',
  )
  process.exit(1)
}

const doSubmit = process.argv.includes('--submit')
const line = (text = '') => process.stdout.write(`${text}\n`)
const step = (n, text) => line(`\n[${n}] ${text}`)

/** 一眼能看出是测试数据 */
const TEST_PREFIX = 'SDK-TEST-'

function stamp () {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

/**
 * 审批人：**默认 15012 乔娜**（实测 `/system/user/simple-page?nickname=乔娜` → `id: 15012`）。
 *
 * 为什么是她：她本来就是本测试账号（姚淼鑫）的**直属上级**（`GET /org/staff/1163` 的
 * `leaderName`），也是请假那条线在本环境里固定的审批人（`qingjia` 的「请假审批」节点）。
 * 也就是一个**早就习惯了这个项目的测试待办**的人 —— 这是本脚本能选的、打扰代价最小的对象。
 *
 * ⚠️ 换人请同时改 `PORTAL_SMOKE_VEHICLE_APPROVER` 与 `…_APPROVER_NAME`：
 * 脚本会按姓名去候选里核对这个 id 真的存在，核不上就退出。
 */
const APPROVER_ID = Number(env.PORTAL_SMOKE_VEHICLE_APPROVER ?? 15012)
const APPROVER_NAME = env.PORTAL_SMOKE_VEHICLE_APPROVER_NAME ?? '乔娜'

/**
 * 用车时间段的默认安排：**明天 09:00 → 明天 18:00**（严格晚于开始，页面与后端都要求）。
 *
 * 用的是「明天」而不是「现在」：本流程**没有任何时间去重校验**
 * （`createApplication` 里连一条冲突判断都没有），所以挑哪天都不撞。
 * 用明天只是为了让这条单据在列表里一眼看得出是脚本造的。
 */
function defaultTimeRange () {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + 1)
  const day = date.toISOString().slice(0, 10)
  return { startTime: `${day} 09:00:00`, endTime: `${day} 18:00:00` }
}

async function loadModules () {
  const [{ createPortalHeadless }, vehicleModule] = await Promise.all([
    import('../dist/index.js'),
    import('../src/capabilities/vehicle-application.ts'),
  ])
  return { createPortalHeadless, vehicleModule }
}

const { createPortalHeadless, vehicleModule } = await loadModules()
const {
  VEHICLE_APPLICATION_FORM_PATH,
  assertAssigneesForTasks,
  assertApproversNotSelf,
  createVehicleApplicationCapability,
  isActiveStaffStatus,
} = vehicleModule

const sdk = createPortalHeadless({
  baseUrl: env.PORTAL_BASE_URL,
  credential: { token: env.PORTAL_TOKEN, tenantId: env.PORTAL_TENANT_ID },
})

// 组装点接上之后就用它（那是真正对外的那一份）；还没接上时自己造一份，
// 走的是同一条 createPageCall（module-type 与 http 实例的推导完全一样）。
const capability =
  sdk.vehicleApplication ??
  createVehicleApplicationCapability((requestConfig) =>
    sdk.call(VEHICLE_APPLICATION_FORM_PATH, requestConfig),
  )

line(`环境 ${env.PORTAL_BASE_URL}，模式：${doSubmit ? '完整链路（含 submit，会打扰真人）' : '只读'}`)
line(`能力来源：${sdk.vehicleApplication ? 'sdk.vehicleApplication（组装点已接线）' : 'createVehicleApplicationCapability + sdk.call（组装点尚未接线）'}`)
line(`附件：本表单**没有附件控件**（载荷里就不会有 attachments 这个键）`)

const range = defaultTimeRange()
const runStamp = stamp()
const draft = {
  reason: env.PORTAL_SMOKE_VEHICLE_REASON ?? `${TEST_PREFIX}用车申请冒烟 ${runStamp}（脚本会在同一轮里撤销它）`,
  destination: env.PORTAL_SMOKE_VEHICLE_DESTINATION ?? `${TEST_PREFIX}冒烟目的地 ${runStamp}`,
  startTime: range.startTime,
  endTime: range.endTime,
}

let createdBusinessKey
let cancelled = false

try {
  // ---- 1. 流程定义 ----
  step(1, '流程定义（只读）GET /bpm/process-definition/get?key=vehicle_usage_application')
  const definition = await capability.definition()
  line(`    名称=${definition.name} category=${definition.category} version=${definition.version}`)
  line(`    formFields=${JSON.stringify(definition.formFields)} formCustomCreatePath=${JSON.stringify(definition.formCustomCreatePath)}`)
  line('    ↑ 两个都是 null：字段契约拿不到，这也是本能力只能读前端源码的原因')
  line(`    但 startUserSelectTasks 这次**有值**：${JSON.stringify(definition.startUserSelectTasks)}`)
  line('    ↑ 三个「发起人自选」节点（**流程定义级**，不等于 prepare 按当前载荷算出来的那组）；BPMN 里**没有网关、没有条件表达式**')

  // ---- 2. 我是谁 ----
  step(2, '我是谁（只读）GET /sys/user/info —— 申请人要的是 staffId，审批人要的是 userId，两者不是一个空间')
  const me = await capability.approverSearch({ keyword: env.PORTAL_SMOKE_ME_KEYWORD ?? '姚淼鑫' })
  const meUser = (me?.list ?? []).find((u) => u.nickname === '姚淼鑫')
  const meId = meUser?.id
  if (meId === undefined) throw new Error('没查到当前登录用户的 userId —— 后面的「审批人不能是自己」判据就无从谈起')
  line(`    我：userId=${meId}（这个数就是审批人 assignees 里要避免出现的那个）`)

  // ---- 3. 申请人选择器的组织范围 ----
  step(3, '申请人选择器的组织范围（只读）GET /org/organization/getRoleOrganizationTree → 摊平')
  const scope = await capability.applicantScope()
  line(`    根组织 ${scope.organizationIds.length} 个：${JSON.stringify(scope.organizationIds)}`)
  line('    ↑ 页面的 getVehicleUsageOrganizationRoots：顶层节点的 children 摊平（没有 children 就取自己）')
  line('    ↑ 页面在这里有一条「超过 50 个就报错」的守卫，SDK 也复刻了')

  // ---- 4. 申请人候选 ----
  step(4, '申请人候选（只读）POST /org/staff/getStaffByOrgPage —— **页面上真正在跑的那一条**')
  const applicants = await capability.applicantPicker({ keyword: '姚淼鑫', pageSize: 5 })
  line(`    total=${applicants.total} 本页 ${(applicants.list ?? []).length} 条`)
  const meStaff = (applicants.list ?? []).find((s) => isActiveStaffStatus(s.status))
  if (!meStaff) throw new Error('没查到自己作为申请人候选（在职状态不在 [1,4,5]？）')
  line(`    选中：staffId=${meStaff.staffId} name=${meStaff.name} staffCode=${meStaff.staffCode} status=${meStaff.status}`)
  line('    ↑ 页面把不在职状态 [1,4,5] 的行整个丢掉；SDK 原样返回后端给的行，判据由 isActiveStaffStatus 给')
  line('    ⚠️ 这个接口的**数组版本**（getStaffByOrg）在本环境对满编账号直接 500：')
  line('       「员工超过1000条，请升级客户端并使用分页选择器，不支持全量数组加载」—— 分页那条才是对的')

  // 从这里开始，draft 就是完整的提交载荷形状
  draft.staffId = meStaff.staffId
  draft.staffName = meStaff.name

  // ---- 5. 审批人候选 ----
  step(5, `审批人候选（只读）GET /system/user/simple-page?nickname=${APPROVER_NAME}`)
  const approvers = await capability.approverSearch({ keyword: APPROVER_NAME })
  const approver = (approvers?.list ?? []).find((u) => Number(u.id) === APPROVER_ID)
  if (!approver) {
    throw new Error(
      `在「${APPROVER_NAME}」的候选里没找到 userId=${APPROVER_ID}。` +
        '换人请同时改 PORTAL_SMOKE_VEHICLE_APPROVER 与 PORTAL_SMOKE_VEHICLE_APPROVER_NAME',
    )
  }
  line(`    找到 userId=${approver.id} ${approver.nickname}（工号 ${approver.code}）`)
  line('    ↑ 页面这里**无关键字翻 9 页 × 500 = 4500 人**（抓包实测）。SDK 强制关键字 + 分页（设计 D6 / H35）')
  line(`    ⚠️ 审批人用的是 **userId**（${approver.id}），申请人的 staffId 是 ${meStaff.staffId} —— 不是一个 id 空间`)

  // ---- 6. prepare ----
  step(6, 'prepare（只读）POST /hr/vehicle-usage-application/getTemporaryRequiredStartUserSelectTasks')
  line(`    载荷：${JSON.stringify(draft)}`)
  const prepared = await capability.prepare(draft)
  line(`    需要人工指定的审批人节点：${prepared.tasks.length} 个`)
  for (const task of prepared.tasks) {
    line(`      · id=${task.id} name=${task.name} min=${task.minSelectCount} max=${task.maxSelectCount} mode=${task.approvalMode}`)
  }
  line('    ↑ 三个节点的 **name 一模一样**（都叫「发起人自选」），只能按 id 认；每个恰好 1 人')
  if (prepared.tasks.length === 0) {
    throw new Error('本流程实测恒为 3 个自选节点，返回 0 个说明流程改版了 —— 停下人工确认')
  }

  // 三个节点都指向同一个人（串行流程，只会产生 1 条待办）
  const assignees = {}
  for (const task of prepared.tasks) assignees[task.id] = [APPROVER_ID]

  if (!doSubmit) {
    step('完', '只读模式到此为止：没有创建任何单据、没有推任何待办。')
    line('    下面这几道**提交前的拒绝**只在 --submit 时跑，这里先干跑一遍给你看：')
    assertTestData(draft)
    line(`    ✓ 事由与目的地都带 ${TEST_PREFIX} 前缀`)
    assertApproversNotSelf(prepared.tasks, assignees, meId)
    line(`    ✓ 审批人（userId=${APPROVER_ID}）不是发起人本人（userId=${meId}）`)
    assertAssigneesForTasks(prepared.tasks, assignees)
    line(`    ✓ startUserSelectAssignees 形状通过本地预检：${JSON.stringify(assignees)}`)
    process.exit(0)
  }

  // ---- 7. 提交前的几道拒绝 ----
  step(7, '提交前的几道拒绝（都在**发出 create 之前**）')

  assertTestData(draft)
  line(`    ✓ 事由与目的地都带 ${TEST_PREFIX} 前缀（本表单没有标题字段，事由是唯一能看出是测试数据的地方）`)
  line(`      事由：${draft.reason}`)
  line(`      目的地：${draft.destination}`)

  if (Number(APPROVER_ID) === Number(meId)) {
    throw new Error(`配置的审批人就是发起人本人（userId=${meId}）—— 脚本自己先不肯发`)
  }
  line(`    ✓ 配置的审批人 userId=${APPROVER_ID} ≠ 发起人 userId=${meId}`)

  // ★ 本流程最危险的一条：三个节点都不能选到自己
  assertApproversNotSelf(prepared.tasks, assignees, meId)
  line(`    ✓ 三个节点都没选到发起人本人（assertApproversNotSelf 用的是能力里导出的同一个纯函数）`)
  line('      ⚠️ 后端有「流程发起人与审批人相同，自动审核通过」：中了的话那个节点当场通过；')
  line('         三个全中时整条流程在 create 返回之前就走完，**cancel 撤不掉、会永久留下一条单据**')

  assertAssigneesForTasks(prepared.tasks, assignees)
  line(`    ✓ startUserSelectAssignees=${JSON.stringify(assignees)} 通过本地预检（每个节点恰好 1 人）`)

  const approverCount = new Set(prepared.tasks.map((t) => assignees[t.id][0])).size
  line(`    ℹ️ 本次会打扰 **${approverCount} 个人**（3 个节点都指向 ${APPROVER_NAME}；串行流程只会创建 1 条待办）`)
  line(`       待办内容：审批一条用车申请，事由「${draft.reason}」`)
  line('       ⚠️ 脚本会**在几分钟内撤销**它，那条待办会随之消失；不撤销的话它会一直挂在对方箱子里')

  // ---- 8. submit ----
  step(8, `★ submit（写操作：真的建单、给 ${APPROVER_NAME} 推待办）POST /hr/vehicle-usage-application/create`)
  try {
    const submitResult = await capability.submit(draft, assignees)
    createdBusinessKey = Number(submitResult)
    line(`    提交成功，业务单据 id（businessKey）= ${submitResult}`)
  } catch (error) {
    line(`    ✗ 提交失败：${error?.name || 'Error'} — ${error?.message || String(error)}`)
    if (error?.code !== undefined) line(`      code=${error.code} ret=${error.ret}`)
    throw error
  }

  try {
    // ---- 9. 独立证实 ①：按 id 查单据 ----
    step(9, '独立证实 ①（只读）GET /hr/vehicle-usage-application/get?id=')
    const record = await capability.detail(createdBusinessKey)
    if (!record) throw new Error(`detail(${createdBusinessKey}) 回了 null —— 提交很可能没落地`)
    line(`    id=${record.id} status=${record.status}(${record.statusName})`)
    line(`    staffId=${record.staffId} staffName=${record.staffName}`)
    line(`    startTime=${record.startTime} → endTime=${record.endTime}`)
    line(`    destination=${JSON.stringify(record.destination)}`)
    line(`    reason=${JSON.stringify(record.reason)}`)
    line(`    ★ processInstanceId=${record.processInstanceId}（**通用审批 / 请假那条线没有这个字段**）`)
    if (record.reason !== draft.reason) throw new Error('详情里的事由与提交的不一致 —— 提交很可能没落地')
    if (record.destination !== draft.destination) throw new Error('详情里的目的地与提交的不一致')
    if (String(record.staffId) !== String(draft.staffId)) throw new Error('详情里的申请人与提交的不一致')
    if (!String(record.startTime ?? '').startsWith(draft.startTime.slice(0, 10))) {
      throw new Error('详情里的开始日期与提交的不一致')
    }
    line('    ✓ 逐字段对上了（事由 / 目的地 / 申请人 / 开始日期）')

    // ---- 10. 独立证实 ②：在「我的流程」里找到它 ----
    step(10, '独立证实 ②（只读）GET /bpm/process-instance/my-page → findInstanceByBusinessKey')
    const instance = await capability.findInstanceByBusinessKey(createdBusinessKey)
    line(`    流程实例 id=${instance.id} key=${instance.processDefinitionKey} status=${instance.status}`)
    line(`    title=${JSON.stringify(instance.title)}`)
    if (String(instance.id) !== String(record.processInstanceId)) {
      line(`    ⚠️ 实例 id 与 detail 里的 processInstanceId 不一致（${instance.id} vs ${record.processInstanceId}）—— 记下来人工看一眼`)
    }
    if (instance.status !== 1) {
      throw new Error(
        `流程实例 status=${instance.status}，不是「审批中」（1）—— 可能被自动通过规则终结了，` +
          '接下来多半撤不掉，请人工看一眼',
      )
    }
    line('    ✓ status=1（审批中），说明这条流程还活着、可以撤')

    // ---- 11. 独立证实 ③：到底打扰了谁 ----
    step(11, '独立证实 ③（只读）GET /bpm/process-instance/getWorkflowPath —— 「实际打扰了谁」的铁证')
    try {
      const path = await sdk.call(VEHICLE_APPLICATION_FORM_PATH, {
        url: '/bpm/process-instance/getWorkflowPath',
        method: 'get',
        params: { processInstanceId: instance.id },
      })
      for (const node of path ?? []) {
        line(
          `    节点「${node.name}」status=${node.status} ` +
            `审批人=${node.assigneeUser ? `${node.assigneeUser.id}/${node.assigneeUser.nickname}` : '(无)'} ` +
            `耗时=${node.durationInMillis ?? '-'}ms`,
        )
      }
      line('    ↑ 有 assignee 的那一行就是**真的收到待办的人**；其它节点还没创建任务')
    } catch (error) {
      line(`    (审批链路没取到：${error?.message || String(error)} —— 不影响本轮的结论)`)
    }

    // ---- 12. cancel ----
    step(12, '★ cancel（写操作）DELETE /bpm/process-instance/cancel-by-start-user')
    const reason = `${TEST_PREFIX}冒烟脚本收尾撤销（自动）`
    // 走 businessKey：resolveProcessInstanceId 会**先试 detail 的 processInstanceId**
    // （用车这条线有这个字段），拿不到才退回翻「我的流程」
    await capability.cancel({ businessKey: createdBusinessKey, reason })
    cancelled = true
    line(`    已发出取消，reason=${JSON.stringify(reason)}（传的是 businessKey，SDK 自己换成了流程实例 id）`)
  } finally {
    if (!cancelled && createdBusinessKey !== undefined) {
      step('!', '中间某步失败了 —— 兜底再撤一次，绝不留一条活的待办在别人的箱子里')
      try {
        await capability.cancel({
          businessKey: createdBusinessKey,
          reason: `${TEST_PREFIX}兜底撤销（前一步失败）`,
        })
        cancelled = true
        line('    兜底撤销成功')
      } catch (error) {
        line(`    ✗ 兜底撤销也失败了，请手工处理 businessKey=${createdBusinessKey}：${error?.message}`)
      }
    }
  }

  // ---- 13. 撤销后的独立证实 ----
  step(13, '撤销后的独立证实（只读）')
  const afterInstance = await capability.findInstanceByBusinessKey(createdBusinessKey)
  line(`    流程实例 status=${afterInstance.status} endTime=${afterInstance.endTime ?? '-'}`)
  if (Number(afterInstance.status) !== 4) {
    line(`    ⚠️ status 不是 4（已取消），请人工确认 businessKey=${createdBusinessKey}`)
  } else {
    line('    ✓ status=4（已取消）')
  }
  const afterRecord = await capability.detail(createdBusinessKey)
  line(`    单据 status=${afterRecord?.status}(${afterRecord?.statusName}) reason=${JSON.stringify(afterRecord?.reason)}`)
  line('    ↑ 用车记录行**不会**随取消被删掉（后端没有那样的监听器）—— 取消的是流程，不是那条业务记录')
  line('    ↑ 但**待办会没**：取消流程会终结掉那个 userTask，对方的待办箱里就干净了')

  try {
    const afterPath = await sdk.call(VEHICLE_APPLICATION_FORM_PATH, {
      url: '/bpm/process-instance/getWorkflowPath',
      method: 'get',
      params: { processInstanceId: afterInstance.id },
    })
    for (const node of afterPath ?? []) {
      line(`    撤销后节点「${node.name}」status=${node.status}（4=已取消）审批人=${node.assigneeUser?.nickname ?? '(无)'}`)
    }
  } catch (error) {
    line(`    (撤销后的审批链路没取到：${error?.message || String(error)})`)
  }

  step('完', `完整链路跑通：提交 businessKey=${createdBusinessKey}，已撤销。`)
} catch (error) {
  process.stderr.write(`\n失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.stack) process.stderr.write(`${error.stack.split('\n').slice(1, 4).join('\n')}\n`)
  process.exitCode = 1
}

/**
 * 事由与目的地都必须是测试数据 —— 提交**之前**的拒绝。
 *
 * 为什么是这两个字段：本表单**没有标题字段**，`instanceName` 是后端拼的
 * `staffName + "-用车审批"`（`VehicleUsageApplicationProcessInstanceVariableBuilder`），
 * 调用方改不了。所以收到待办的人只能从**事由**里看出这是测试数据。
 */
function assertTestData (current) {
  for (const field of ['reason', 'destination']) {
    if (!String(current[field] ?? '').startsWith(TEST_PREFIX)) {
      throw new Error(`${field} 必须以 ${TEST_PREFIX} 开头（收到 ${JSON.stringify(current[field])}）`)
    }
  }
}
