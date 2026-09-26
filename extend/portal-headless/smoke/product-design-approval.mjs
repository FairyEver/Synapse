#!/usr/bin/env node
/**
 * 冒烟：产品设计文档审核（`hr_product_design_approval` / `/simple/hr/form/045`）
 * 在真实测试环境上的完整链路。
 *
 * 三种模式：
 *
 * ```bash
 * # 只读（默认）：定义 / 搜人 / prepare / 审批链预览 四段，一个字节都不写
 * smoke/with-portal-token.sh node smoke/product-design-approval.mjs
 *
 * # 完整链路：多跑 submit → 独立证实 → cancel → 再证实
 * smoke/with-portal-token.sh node smoke/product-design-approval.mjs --submit
 *
 * # 完整链路 + 附件：先真传一个文件到 OSS，用它当附件提交，收尾时把对象也删掉
 * smoke/with-oss-credentials.sh smoke/with-portal-token.sh \
 *   node smoke/product-design-approval.mjs --submit --attachment
 * ```
 *
 * ## 附件模式（`--attachment`）：它要**两套凭据**，所以要嵌两层
 *
 * Portal 的会话 token 与 OSS 的 AK/SK **在两条不同的路上**（`with-portal-token.sh`
 * 从浏览器 cookie 取，`with-oss-credentials.sh` 从构建期 env 读），**没法一次取全**，
 * 所以是**嵌套**：外层注入 OSS_*，内层注入 PORTAL_*，环境变量顺着进程继承下去。
 *
 * 附件模式做的事：
 *
 * 1. `sdk.baseUpload.upload()` 真往 `HR/approval`（表单自己的目录）传一个小 CSV 探针；
 * 2. 用它的 `url` 组成 `attachments: [{url, name}]` 走一遍提交；
 * 3. 提交后的独立证实里**多查一条**：单据详情返回的附件 url 与 name 与传上去的一致；
 * 4. 收尾时**清理两样**：撤销单据 + 用签名 DELETE 删掉那个 OSS 对象，
 *    删完再匿名 GET 一次，确认打不开（否则不算删掉）。
 *
 * ⚠️ 清理放在 `finally` 里：中间任何一步炸了，对象也会被删掉。**不留孤儿对象。**
 *
 * ## ⚠️ `--submit` 会**真的给真人推待办**
 *
 * 用户 2026-09-20 的授权原文：「**允许在测试环境提交，接受打扰真人。**」
 * 但授权不是"随便提交"，脚本按下面几条自我约束：
 *
 * 1. **标题与内容强制带 `SDK-TEST-` 前缀**，脚本自己先断言一次（`assertTestData()`）。
 * 2. **`copyUserIds` 固定 `[]`**：抄送会真的通知到人，测试不留抄送。
 * 3. **审批人只选一个**：本流程 `minSelectCount = 1`，多选只是多打扰人。
 * 4. ⚠️⚠️ **审批人绝对不能是发起人本人** —— 见下面那一大段。这条在这里是**硬拒绝**，
 *    不是警告。
 * 5. **提交成功后一定会尝试撤销**（在 `finally` 里）。
 * 6. **绝不碰别人的单据**：只操作本脚本自己刚建的那一条。
 *
 * ## ⚠️ 为什么「审批人不能是自己」是**硬拒绝**
 *
 * 后端有一条「流程发起人与审批人相同，自动审核通过」（`BpmTaskServiceImpl:913-916`）。
 * 发起人 = 审批人时流程**当场走完**，`cancel-by-start-user` 必然报
 * 「流程取消失败，流程不处于运行中」——**永久留下一条撤不掉的单据**。
 * 测试环境里**已经有 3 条**这样的单据了（别的前几轮留下的）。**本脚本一条都不再加。**
 *
 * 判据有**两条，必须同时满足**才允许提交（**fail closed**）：
 *
 * - **判据 A「我是谁」**：从「我的流程」最近一条的 `startUser.id` 推。推不出来
 *   （账号一条流程都没发起过）就**拒绝提交**，因为下面的比对根本没有基准。
 * - **判据 B「审批链预览」**：`POST /bpm/process-instance/preview` 拿到的审批链里，
 *   若发起人本人出现在审批人位置上，**拒绝**。这条正对着上面那条后端规则。
 *
 * 两条都过才提交。任何一条判不了，脚本报错退出，**不"反正先提交看看"**。
 *
 * ## 为什么这个脚本直接 import `src/` 下的 .ts
 *
 * - **管道**取自 `dist/index.js`（已构建产物）。
 * - **能力实现**取自 `../src/capabilities/product-design-approval.ts`——Node 22 的类型剥离
 *   直接认它（这个文件只 import type，运行时没有别的依赖）。这样脚本**不需要先 `pnpm build`**，
 *   也不必等组装点把 `sdk.productDesignApproval` 接上；接上之后会自动优先用它。
 *
 * 需要三个环境变量（凭据不落盘、不进代码；用 `smoke/with-portal-token.sh` 自动注入）：
 *   PORTAL_BASE_URL / PORTAL_TOKEN / PORTAL_TENANT_ID
 */

import { randomUUID } from 'node:crypto'

import { createPortalHeadless } from '../dist/index.js'
// OSS 那两件取自 dist 的**能力模块**，与 smoke/upload.mjs 同一个来源：
// `prepareOssRequest` 是签名 DELETE 的唯一入口（能力对象上没有暴露 delete）。
import { assertOssConfig, prepareOssRequest } from '../dist/capabilities/base-upload.js'
import {
  PRODUCT_DESIGN_APPROVAL_FORM_PATH,
  PRODUCT_DESIGN_APPROVAL_PROCESS_KEY,
  assertAssigneesForTasks,
  createProductDesignApprovalCapability,
} from '../src/capabilities/product-design-approval.ts'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法（推荐，token 由脚本自己取）：\n' +
      '  smoke/with-portal-token.sh node smoke/product-design-approval.mjs [--submit]\n',
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

function assertTestData (draft) {
  for (const field of ['applicationItem', 'applicationContent']) {
    if (!String(draft[field] ?? '').startsWith(TEST_PREFIX)) {
      throw new Error(`${field} 必须以 ${TEST_PREFIX} 开头（收到 ${JSON.stringify(draft[field])}）`)
    }
  }
}

// ---- 附件模式要的第二套凭据（OSS AK/SK），缺了就在 --attachment 时拒绝，不半跑 ----
const withAttachment = process.argv.includes('--attachment')
if (withAttachment && !doSubmit) {
  process.stderr.write('--attachment 必须与 --submit 一起用（只读模式不提交，附件没有落点）\n')
  process.exit(2)
}

const ossEnv = {
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET,
  endpoint: process.env.OSS_ENDPOINT,
  region: process.env.OSS_REGION,
}
const ossMissing = ['accessKeyId', 'accessKeySecret', 'bucket', 'endpoint']
  .filter((name) => !ossEnv[name])

if (withAttachment && ossMissing.length > 0) {
  process.stderr.write(
    `--attachment 需要 OSS 凭据，缺：${ossMissing.join(', ')}\n\n` +
      '用法（两套凭据分别由两个脚本注入，所以是嵌套的）：\n' +
      '  smoke/with-oss-credentials.sh smoke/with-portal-token.sh \\\n' +
      '    node smoke/product-design-approval.mjs --submit --attachment\n',
  )
  process.exit(1)
}

const sdk = createPortalHeadless({
  baseUrl,
  credential: { token, tenantId },
  // 没跑附件模式时不传 oss：那时上传能力应当保持「没配凭据」的状态（失败关闭）
  ...(withAttachment ? { oss: ossEnv } : {}),
})

// 组装点接上之后就用它；还没接上时自己造一份，走的是同一条 createPageCall。
const capability =
  sdk.productDesignApproval ??
  createProductDesignApprovalCapability((requestConfig) =>
    sdk.call(PRODUCT_DESIGN_APPROVAL_FORM_PATH, requestConfig),
  )

const mode = doSubmit ? (withAttachment ? '完整链路 + 附件' : '完整链路（含 submit，会打扰真人）') : '只读'
line(`环境 ${baseUrl}，模式：${mode}`)
line(`流程 key=${PRODUCT_DESIGN_APPROVAL_PROCESS_KEY} 表单=${PRODUCT_DESIGN_APPROVAL_FORM_PATH}`)
line(
  `能力来源：${sdk.productDesignApproval ? 'sdk.productDesignApproval（组装点已接线）' : 'createProductDesignApprovalCapability + sdk.call（组装点尚未接线）'}`,
)

/**
 * 当前登录用户是谁。
 *
 * ⚠️ 没有直接可用的「我是谁」接口：`GET /system/user/profile/get` 在这个 token 上
 * 报 500（实测）。所以从「我的流程」最近一条的 `startUser.id` 推出来。
 * 推不出来时返回 undefined —— 而 `--submit` 分支**见到 undefined 就拒绝提交**
 * （审批人守卫没有基准，fail closed）。
 */
async function currentUserId () {
  const mine = await capability.myInstances({ pageSize: 1 })
  const id = mine?.list?.[0]?.startUser?.id
  return typeof id === 'number' ? id : undefined
}

let createdBusinessKey
let cancelled = false
/** 附件模式传上去的那个对象。**无论后面哪一步炸了，都要删掉它** */
let uploadedObjectKey
let uploadedBody
let ossCleaned = false

/**
 * 删掉自己传的 OSS 对象，并**独立证实它真的没了**。
 * 不能只看 DELETE 的 200（那只是"OSS 收下了请求"），所以删完再**匿名 GET** 一次。
 */
async function cleanupOss () {
  if (uploadedObjectKey === undefined || ossCleaned) return
  step('10', '清理 OSS：签名 DELETE + 匿名 GET 复核')
  const config = assertOssConfig(ossEnv)
  const del = prepareOssRequest({ config, method: 'DELETE', objectKey: uploadedObjectKey })
  const response = await fetch(del.url, { method: del.method, headers: del.headers })
  line(`    DELETE ${uploadedObjectKey} → HTTP ${response.status}`)
  if (!response.ok) {
    line(`    ✗ 删除没成功，桶里留了孤儿对象，请人工清掉：${uploadedObjectKey}`)
    return
  }
  ossCleaned = true

  const anon = await fetch(del.url.split('?')[0])
  const anonBody = await anon.text()
  line(`    删后匿名 GET → HTTP ${anon.status}（期望 403/404），body 前 60 字：${JSON.stringify(anonBody.slice(0, 60))}`)
  if (anon.status === 200 && anonBody === uploadedBody) {
    throw new Error('删完还能匿名读到原内容 —— 对象其实没删掉')
  }
  line('    ✓ 删后匿名读打不开，且不再是原来那份字节')
}

try {
  // ---- 1. 流程定义 ----
  step(1, '流程定义（只读）GET /bpm/process-definition/get?key=hr_product_design_approval')
  const definition = await capability.definition()
  line(`    名称=${definition.name} category=${definition.category} version=${definition.version}`)
  line(`    formFields=${JSON.stringify(definition.formFields)} formCustomCreatePath=${JSON.stringify(definition.formCustomCreatePath)}`)
  line('    ↑ 两个都是 null：字段契约拿不到，这也是本能力只能读前端源码的原因')
  if (definition.name !== '产品设计文档审核') {
    throw new Error(`流程名不是「产品设计文档审核」而是 ${JSON.stringify(definition.name)} —— key 可能不对，停下`)
  }

  // ---- 2. 人员候选 ----
  step(2, '按关键字搜人（只读）—— 长选项参数必须先给关键字')
  const keyword = process.env.PORTAL_SMOKE_APPROVER_KEYWORD || '姚'
  const users = await capability.searchUsers({ keyword, pageSize: 5 })
  line(`    keyword=${JSON.stringify(keyword)} 命中 ${users.total} 人，取前 ${users.list.length} 个：`)
  for (const user of users.list) line(`      - id=${user.id} ${user.nickname} ${user.code ?? ''}`)

  // 无关键字必须被拒（这条只读，跑一次证明保护真的在）
  try {
    await capability.searchUsers({})
    throw new Error('无关键字的 searchUsers 竟然没被拒绝——长选项保护失效了')
  } catch (error) {
    if (/竟然没被拒绝/.test(String(error?.message))) throw error
    line(`    无关键字的调用被拒绝：${String(error?.message).slice(0, 60)}…`)
  }

  // ---- 2.5 附件：真传一个文件到 OSS（只有 --attachment 时） ----
  const attachments = []
  if (withAttachment) {
    step('2.5', '★ 真传附件（写外部存储）sdk.baseUpload.upload()')
    // ⚠️ 扩展名必须在**表单自己的 accept 白名单**里，否则 SDK 在本地就把它拒了。
    // 用 .csv 而不是"把文本改名成 .pdf"：探针本身就该是它自称的那种文件。
    const fileName = `${TEST_PREFIX}产品设计文档审核冒烟附件.csv`
    const body = `${TEST_PREFIX}说明,这是一条测试附件\n由 portal-headless SDK 冒烟脚本上传,会在同一轮里删除\n${randomUUID()}\n`
    const uploaded = await sdk.baseUpload.upload({
      content: Buffer.from(body, 'utf8'),
      // 表单自己的目录：045 的 common-upload-dragger 传的就是 ossFilePathOptions.hr.approval
      folder: 'HR/approval',
      fileName,
      contentType: 'text/csv',
    })
    uploadedBody = body
    uploadedObjectKey = uploaded.objectKey
    line(`    url=${uploaded.url}`)
    line(`    objectKey=${uploaded.objectKey} size=${uploaded.size} acl=${uploaded.acl ?? '<读不出来>'}`)
    if (uploaded.acl !== 'public-read') {
      throw new Error(`ACL 读回来是 ${JSON.stringify(uploaded.acl)}，不是 public-read —— 这个 url 别人打不开，别拿去提交`)
    }
    const anon = await fetch(uploaded.url)
    const anonBody = await anon.text()
    line(`    传后匿名 GET → HTTP ${anon.status}，字节${anonBody === body ? '逐字节一致 ✓' : '与上传的不一致 ✗'}`)
    if (anon.status !== 200 || anonBody !== body) {
      throw new Error('传上去的 url 匿名读不出来或内容不一致，先别拿去提交')
    }
    attachments.push({ url: uploaded.url, name: fileName })
  }

  // ---- 3. prepare ----
  const draft = {
    applicationItem: `${TEST_PREFIX}产品设计文档审核冒烟 ${stamp()}`,
    applicationContent: `${TEST_PREFIX}这是一条由 portal-headless SDK 冒烟脚本创建的测试数据，脚本会在同一轮里撤销它。`,
    attachments,
    // 抄送会真的通知到人 ⇒ 测试留空
    copyUserIds: [],
  }
  assertTestData(draft)

  step(3, 'prepare（只读）POST /hr/product-design-approval/getTemporaryRequiredStartUserSelectTasks')
  line(`    载荷：${JSON.stringify(draft)}`)
  const { tasks } = await capability.prepare(draft)
  line(`    需要人工指定的审批人节点：${tasks.length} 个`)
  for (const task of tasks) {
    line(
      `      - ${task.name}（${task.id}）最少 ${task.minSelectCount ?? '-'} 最多 ${task.maxSelectCount ?? '-'} ` +
        `${task.approvalMode ?? ''} 顺序有意义=${task.selectionOrderRequired ?? '-'}`,
    )
  }

  // ---- 3.5 审批链预览（只读）----
  step('3.5', '「查看审批流程」预览（只读）POST /bpm/process-instance/preview')
  const previewEmpty = await capability.preview(draft)
  line(`    空 assignees 的预览返回顶层字段：${JSON.stringify(Object.keys(previewEmpty ?? {}))}`)
  line(`    原样（截断 400 字）：${JSON.stringify(previewEmpty).slice(0, 400)}`)

  if (!doSubmit) {
    step('完', '只读模式到此为止：没有创建任何单据、没有推任何待办、没有写 OSS。')
    process.exit(0)
  }

  // ---- 4. 选审批人 + 两道守卫 ----
  step(4, '挑审批人 + 两道守卫（**任一不满足就拒绝提交**，不发 create）')
  const approverKeyword = process.env.PORTAL_SMOKE_APPROVER_KEYWORD
  if (!approverKeyword) {
    throw new Error(
      '完整链路必须给 PORTAL_SMOKE_APPROVER_KEYWORD —— 审批人是谁由你定，' +
        '脚本不替你猜一个人出来（名字也不该进仓库）。',
    )
  }
  const candidates = await capability.searchUsers({ keyword: approverKeyword, pageSize: 5 })
  const approver = candidates.list[0]
  if (!approver) throw new Error(`按 ${JSON.stringify(approverKeyword)} 没搜到人，换一个关键字`)
  line(`    审批人：id=${approver.id} ${approver.nickname}（只选这一个，免得打扰更多人）`)

  // 守卫 A：我是谁必须推得出来
  const me = await currentUserId()
  if (me === undefined) {
    throw new Error(
      '推不出当前登录用户 id（「我的流程」是空的）—— 没有基准就没法证明「审批人不是发起人」，' +
        '而选错的代价是一条**永久撤不掉**的单据。**拒绝提交**（fail closed）。',
    )
  }
  line(`    守卫 A：当前登录用户 id=${me}（从「我的流程」最近一条的 startUser 推出来的）`)
  if (Number(approver.id) === me) {
    throw new Error(
      `审批人选成了自己（${approver.id} ${approver.nickname}）：后端有` +
        '「流程发起人与审批人相同，自动审核通过」的规则，流程会当场结束，' +
        '接下来必然撤不掉（cancel 会报「流程不处于运行中」）。换一个审批人。',
    )
  }

  // 守卫 B：审批链预览里发起人本人不能出现在**审批人**位置上
  const assigneesForPreview = {}
  for (const task of tasks) assigneesForPreview[task.id] = [approver.id]
  const preview = await capability.preview(draft, assigneesForPreview)
  const meRow = (await capability.myInstances({ pageSize: 1 }))?.list?.[0]?.startUser
  // 审批链在 `nodes` 里（实测；**不叫 `activities`**）
  const nodes = Array.isArray(preview?.nodes) ? preview.nodes : []
  line(`    守卫 B：审批链预览（选了 ${approver.nickname} 之后）`)
  for (const node of nodes) {
    line(
      `      - [${node?.type ?? '?'}] ${node?.nodeId ?? '?'} ${node?.name ?? ''} ` +
        `strategy=${node?.candidateStrategyName ?? '-'} mode=${node?.approvalMode ?? '-'} ` +
        `users=${JSON.stringify((node?.candidateUsers ?? []).map((u) => `${u.id}:${u.nickname}`))}`,
    )
  }
  // 只判**审批人节点**（`USER_TASK`）：开始 / 结束事件上出现谁都不算。
  const meInApproverSeat = nodes.some((node) => {
    if (String(node?.type ?? '').toUpperCase() !== 'USER_TASK') return false
    return (Array.isArray(node?.candidateUsers) ? node.candidateUsers : []).some(
      (user) => Number(user?.id) === me,
    )
  })
  if (meInApproverSeat) {
    throw new Error(
      `审批链预览显示发起人（id=${me}${meRow?.nickname ? ` ${meRow.nickname}` : ''}）被放在了` +
        '一个 USER_TASK 审批节点的 candidateUsers 里 —— 这正是后端' +
        '「流程发起人与审批人相同，自动审核通过」的触发条件。**拒绝提交**。',
    )
  }
  if (nodes.length === 0) {
    line('    ⚠️ 预览响应里没有 nodes 数组 —— 守卫 B **没测到东西**，')
    line('      本次提交实际只靠守卫 A 挡住「选自己」。如实记下这个盲区，不要读成"守卫 B 通过"。')
  } else {
    const userTasks = nodes.filter((n) => String(n?.type ?? '').toUpperCase() === 'USER_TASK')
    line(`    守卫 B：审批链 ${nodes.length} 个节点（其中 USER_TASK ${userTasks.length} 个），发起人不在审批人位置上 ✓`)
  }

  const assignees = {}
  for (const task of tasks) assignees[task.id] = [approver.id]
  assertAssigneesForTasks(tasks, assignees)
  line(`    startUserSelectAssignees=${JSON.stringify(assignees)} 通过本地预检`)

  // ---- 5. submit ----
  step(5, '★ submit（写操作：真的起流程、给上面那个人推待办）POST /hr/product-design-approval/create')
  let submitResult
  try {
    submitResult = await capability.submit(draft, assignees)
    createdBusinessKey = Number(submitResult)
    line(`    提交成功，业务单据 id（businessKey）= ${submitResult}`)
  } catch (error) {
    line(`    ✗ 提交失败：${error?.name || 'Error'} — ${error?.message || String(error)}`)
    if (error?.code !== undefined) line(`      code=${error.code} ret=${error.ret}`)
    throw error
  }

  try {
    // ---- 6. 独立证实 ①：按 id 查单据 ----
    step(6, '独立证实 ①（只读）GET /hr/product-design-approval/get?id=')
    const record = await capability.detail(createdBusinessKey)
    // ⚠️ 这里的 status 可能还是 0（待提交）：单据状态是**流程监听器异步回写**的。
    line(`    id=${record.id} status=${record.status}(${record.statusName}) 附件=${(record.attachments ?? []).length} 件`)
    line('    ↑ statusName 恒为 null（后端 VO 声明了它但没填，实测）')
    line(`    申请事项=${JSON.stringify(record.applicationItem)}`)
    if (record.applicationItem !== draft.applicationItem) {
      throw new Error('详情里的申请事项与提交的不一致——提交很可能没落地')
    }
    if (record.applicationContent !== draft.applicationContent) {
      throw new Error('详情里的申请内容与提交的不一致——提交很可能没落地')
    }
    if (withAttachment) {
      const saved = record.attachments ?? []
      line(`    附件回读：${JSON.stringify(saved)}`)
      if (saved.length !== 1) {
        throw new Error(`详情里的附件应有 1 件，实际 ${saved.length} 件 —— 附件字段没落地`)
      }
      if (saved[0]?.url !== attachments[0].url || saved[0]?.name !== attachments[0].name) {
        throw new Error(
          `详情里的附件与提交的不一致：提交 ${JSON.stringify(attachments[0])}，回读 ${JSON.stringify(saved[0])}`,
        )
      }
      line('    ✓ 附件的 url 与 name 与传上去的逐字段一致')
    } else if ((record.attachments ?? []).length !== 0) {
      throw new Error('没传附件，详情里却有附件 —— 提交的载荷被谁改过')
    }

    // ---- 7. 独立证实 ②：在「我的流程」里找到它 ----
    step(7, '独立证实 ②（只读）GET /bpm/process-instance/my-page → findInstanceByBusinessKey')
    const instance = await capability.findInstanceByBusinessKey(createdBusinessKey)
    line(`    流程实例 id=${instance.id} key=${instance.processDefinitionKey} status=${instance.status}`)
    line(`    title=${JSON.stringify(instance.title)}`)
    if (instance.processDefinitionKey !== PRODUCT_DESIGN_APPROVAL_PROCESS_KEY) {
      throw new Error(`找回来的流程实例 key 是 ${instance.processDefinitionKey} —— 认错单子了`)
    }
    // ⚠️ 这条**必须查**：status 已经是终态（2/3）就说明它当场走完了，cancel 注定失败。
    if (instance.status !== 1) {
      line(`    ⚠️ 流程实例 status=${instance.status} 不是 1（审批中）—— 它可能当场走完了，撤不掉`)
    }

    // ---- 8. cancel ----
    step(8, '★ cancel（写操作）DELETE /bpm/process-instance/cancel-by-start-user')
    const reason = `${TEST_PREFIX}冒烟脚本收尾撤销（自动）`
    await capability.cancel({ processInstanceId: instance.id, reason })
    cancelled = true
    line(`    已发出取消，reason=${JSON.stringify(reason)}`)
  } finally {
    if (!cancelled && createdBusinessKey !== undefined) {
      step('!', '中间某步失败了 —— 兜底再撤一次，绝不留一条活的待办在别人（或你自己的）箱子里')
      try {
        const instance = await capability.findInstanceByBusinessKey(createdBusinessKey)
        await capability.cancel({
          processInstanceId: instance.id,
          reason: `${TEST_PREFIX}兜底撤销（前一步失败）`,
        })
        cancelled = true
        line('    兜底撤销成功')
      } catch (error) {
        line(`    ✗ 兜底撤销也失败了，请手工处理 businessKey=${createdBusinessKey}：${error?.message}`)
      }
    }
  }

  // ---- 9. 撤销后的独立证实 ----
  step(9, '撤销后的独立证实（只读）')
  const after = await capability.detail(createdBusinessKey)
  line(`    单据 status=${after.status}(${after.statusName})`)
  const afterInstance = await capability.findInstanceByBusinessKey(createdBusinessKey)
  line(`    流程实例 status=${afterInstance.status} endTime=${afterInstance.endTime ?? '-'}`)
  if (afterInstance.status !== 4) {
    line(`    ⚠️ 撤销后流程实例 status=${afterInstance.status}，不是 4（已取消）—— 请人工确认`)
  } else {
    line('    ✓ 流程实例 status=4（已取消），撤销真的落地了')
  }

  await cleanupOss()

  step('完', `完整链路跑通：提交 businessKey=${createdBusinessKey}，已撤销${ossCleaned ? '，传上去的 OSS 对象也已删除' : ''}。`)
} catch (error) {
  try {
    await cleanupOss()
  } catch (cleanupError) {
    process.stderr.write(`清理 OSS 时又失败了一次：${cleanupError?.message}\n`)
  }
  process.stderr.write(`\n失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.stack) process.stderr.write(`${error.stack.split('\n').slice(1, 4).join('\n')}\n`)
  process.exit(1)
}
