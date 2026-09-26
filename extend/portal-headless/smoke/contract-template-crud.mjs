#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 环境跑一遍「合同模板」的**写链路**（新建 → 改 → 删），
 * 页面 `/dashboard/contract/template/list`。
 *
 * 需要三个环境变量（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL / PORTAL_TOKEN / PORTAL_TENANT_ID
 *
 * 运行：smoke/with-portal-token.sh node smoke/contract-template-crud.mjs
 *
 * ## 它会真的写数据，所以规矩写在这里
 *
 * - 模板名一律 `SDK-TEST-` 前缀 + 时间戳后 6 位，一眼能看出是测试数据。
 * - **只碰自己建的这一条**。测试环境里原有 14 条模板，一条都不动
 *   （删别人的模板是破坏性操作，这一条是硬规矩）。
 * - 收尾复核：按两个名字各查一次列表，都必须是 0 条。
 *
 * ## 只走页面的「仅保存」，绝不走「保存并提交」
 *
 * 表单页有两个提交按钮：`actionSubmit(false)`（仅保存，`onlySubmit: 1`）与
 * `actionSubmit(true)`（保存并提交，`onlySubmit: 0`）。后者在后端会**真的
 * `createProcessInstance` 起一条 `contract_template` 审批流**，给真人推待办与通知 ——
 * 那不是「一条脏数据」，是一串人的待办箱里多出一条假单据。本脚本**一次都不碰它**。
 *
 * 脚本末尾有一个**只读探针**（`PROBE_DEAD_ENDPOINT`）去核一件事：
 * 「保存并提交」在前端第一步打的 `POST /hr/contract-template/getRequiredStartUserSelectTasks`
 * 在后端**有没有映射**。预期是 404 —— 有映射的话 SDK 就该重新考虑要不要实现那一支。
 * 探针只发一次 GET/POST、不做任何写，也不影响结论的其余部分。
 *
 * ## 「独立证实」是什么
 *
 * 这个页面**没有第二个视图**（不像会议室预定能去占用查询里看），所以证实只能靠
 * **同一接口的两次独立读取**：建完按名字查列表、再按 id 取详情，且提交值与读回值逐项比对。
 * 这条差别在作业管理、班次管理两条线上已经记过两次，这里同理。
 *
 * ## 步骤
 *
 *   0. 起手：按 `SDK-TEST-` 前缀查列表 —— 必须是 0 条（排除"本来就有一条"这种假阳性）
 *   1. create（经 `createIdempotent`，D12）→ 独立证实①：按名字查列表恰好 1 条，记下 id 与它的 typeof
 *   2. 独立证实②：按 id 取详情，四个字段与提交值逐项一致；status 应是 1（待提交，因为只保存不发流程）
 *   3. 同一个 requestId 重试 —— 列表仍 1 条，且第二次 POST **根本没发出去**
 *   4. update（改名 + 换所属系统）→ get：两个字段都变了；旧名字 0 条
 *   5. update 原样重发一次 —— 仍 1 条，终态不变（update 不需要 requestId 的实测依据）
 *   6. remove → 列表查不到；重复 remove 后端仍返回成功
 *   7. remove 之后 get(id) —— 把真实结果**如实打出来**（逻辑删除的现场）
 *   8. 收尾：按两个名字各查一次 —— 0 条
 */
import axios from 'axios'

// 防重那三个从**门面**取（`src/index.ts` 已经导出它们），不从 `src/idempotency/` 直接 import：
// `.mjs` import TS 源码时 Node 不会把源码里的 `./xxx.js` 重新映射到 `.ts`，
// 而 `src/idempotency/index.ts` 有一堆**值**导入（不是 type-only），解析不了。
// 本页的能力文件之所以能从 `../src/` 直接 import，是因为它内部只有 `import type`，会被整句擦掉。
import { IdempotencyStore, createPortalHeadless, createRequestId, withIdempotency } from '../dist/index.js'
import {
  CONTRACT_TEMPLATE_PAGE_PATH,
  EMPTY_TEMPLATE_CONTENT,
  buildTemplatePayload,
  createContractTemplateCapability,
} from '../src/capabilities/contract-template.ts'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法：smoke/with-portal-token.sh node smoke/contract-template-crud.mjs\n',
  )
  process.exit(1)
}

const PAGE = CONTRACT_TEMPLATE_PAGE_PATH
const sdk = createPortalHeadless({ baseUrl, credential: { token, tenantId } })

/** 手工接线：能力实现与门面用的是同一个 `call` */
const templateBase = createContractTemplateCapability((config) => sdk.call(PAGE, config))

/**
 * `createIdempotent` 的接线与 `src/index.ts` 里班次管理那段**逐字同构**，
 * 只是 capabilityId 换成本页的。门面接线后这一段可以删掉。
 */
const template = {
  ...templateBase,
  createIdempotent: withIdempotency({
    store: new IdempotencyStore({}),
    capabilityId: 'contract-template-create',
    identity: () => ({ userId: 'smoke', tenantId }),
    payload: (params) => buildTemplatePayload(params),
    send: (_params, { payload }) => templateBase.create(payload),
  }),
}

const sent = []
const innerAdapter = axios.getAdapter(axios.defaults.adapter)
sdk.http.defaults.adapter = async (config) => {
  sent.push(`${String(config.method).toUpperCase()} ${String(config.url)}`)
  return innerAdapter(config)
}
const strip = (url) => url.replace(/([?&]_t=)\d+/, '$1<ts>')

const resolved = sdk.resolveModuleType(PAGE)
process.stdout.write(
  `页面：${PAGE}\n` +
    `module-type：${resolved.moduleType} ${resolved.label}\n` +
    `写链路：create → get 复核 → update → remove（记录名一律 SDK-TEST- 前缀，只走「仅保存」）\n\n`,
)

const stamp = String(Date.now()).slice(-6)
const NAME = `SDK-TEST-合同模板-${stamp}`
// ⚠️ 改后的名字**不能包含原名**：name 是模糊匹配，否则"旧名字查不到了"这条断言会假绿
//（作业管理那条线上踩过这个坑）。
const NAME2 = `SDK-TEST-模板改-${stamp}`
/** 采购合同。基准里浏览器选的就是它（`baseline/contract-template.browser.json` 第 3 条 typeId=13） */
const TYPE_ID = 13
const USE_SYSTEM = 0 // 公共

let failures = 0
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1
  process.stdout.write(`   ${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}\n`)
}
const note = (label) => process.stdout.write(`   · ${label}\n`)

/** 按名字查列表，返回 {total, list}（这个页面的独立证实只能用同一接口的两次读） */
async function byName (name) {
  return template.list({ name, pageNo: 1, pageSize: 20 })
}

/** 收尾用：按 `SDK-TEST-` 前缀扫一遍，看有没有别的东西被留下（只读，不删别人的） */
async function anyTestPrefix () {
  return template.list({ name: 'SDK-TEST-', pageNo: 1, pageSize: 50 })
}

let id
let createdIdempotentResult

try {
  // 0 起手
  const before = await byName(NAME)
  const prefixBefore = await anyTestPrefix()
  process.stdout.write(`0. 起手：按名字查列表\n`)
  check(before.total === 0, `「${NAME}」建之前是 0 条`, `实际 ${before.total} 条`)
  check(
    prefixBefore.total === 0,
    '整个 `SDK-TEST-` 前缀下也是 0 条（没有别人的测试数据被我误伤 / 没有上次的残留）',
    `实际 ${prefixBefore.total} 条`,
  )
  if (before.total !== 0 || prefixBefore.total !== 0) {
    process.stderr.write('\n✗ 起手就不干净，中止（不做任何写操作）\n')
    process.exit(1)
  }

  // 1 create（带防重）
  const requestId = createRequestId()
  createdIdempotentResult = await template.createIdempotent({
    typeId: TYPE_ID,
    name: NAME,
    useSystem: USE_SYSTEM,
    content: EMPTY_TEMPLATE_CONTENT,
    requestId,
  })
  process.stdout.write(`\n1. create（createIdempotent，requestId=${requestId}）\n`)
  process.stdout.write(`   ${strip(sent[sent.length - 1])}\n`)
  // 后端 create 返回的是新记录的 id（`CommonResult<Long>`）—— 与班次管理那条线相反（那边回空）。
  // 但"接口说成功"不算验证，下面仍然回列表按名字查一次。
  note(`响应回来的是 ${JSON.stringify(createdIdempotentResult)}（后端其实回传了新 id）`)
  const afterCreate = await byName(NAME)
  check(afterCreate.total === 1, '独立证实① 按名字查列表恰好 1 条', `实际 ${afterCreate.total} 条`)
  id = afterCreate.list[0]?.id
  // 顺手记下 id 的类型：基准里浏览器 PUT 回传的是 **number**（`"id":77`），
  // 与班次管理那条线（后端给字符串）相反。这个观察要如实写进文档。
  check(id !== undefined && id !== null, `拿到新记录 id=${JSON.stringify(id)}（typeof ${typeof id}）`)
  check(
    String(createdIdempotentResult) === String(id),
    'create 的返回值就是这条记录的 id（两边一致，不是两个不同的数字）',
    `返回值 ${JSON.stringify(createdIdempotentResult)} / 列表查到的 ${JSON.stringify(id)}`,
  )

  // 2 详情逐项比对
  const one = await template.get(id)
  process.stdout.write(`\n2. 独立证实② 按 id 取详情（${strip(sent[sent.length - 1])}）\n`)
  check(one.name === NAME, 'name 与提交值一致', `读回 ${one.name}`)
  check(String(one.typeId) === String(TYPE_ID), 'typeId 与提交值一致', `读回 ${one.typeId}`)
  check(one.typeName === '采购合同', 'typeName 是后端 join 出来的「采购合同」（反过来印证 13 是真的字典 id）', `读回 ${one.typeName}`)
  check(Number(one.useSystem) === USE_SYSTEM, 'useSystem 与提交值一致', `读回 ${one.useSystem}`)
  check(
    one.status === 1,
    'status = 1 待提交 —— **只保存不发流程**的现场（`onlySubmit: 1` 那一支）',
    `读回 ${one.status}`,
  )
  check(
    typeof one.content === 'string' && JSON.parse(one.content).version === '1.0.0',
    'content 读回来是 JSON 字符串且能被解析',
    `version=${JSON.parse(one.content).version}`,
  )
  check(
    one.processInstanceId === null || one.processInstanceId === undefined || one.processInstanceId === '',
    'processInstanceId 是空的 —— 确认没有起过审批流（这条是本次「不发流程」的硬证据）',
    `读回 ${JSON.stringify(one.processInstanceId)}`,
  )

  // 3 同一个 requestId 重试
  // 真正的证据是"第二次有没有真的发出去"——只比对返回值是**恒真**的：
  // 后端 create 返回的是 `CommonResult<Long>`，两次可能都是同一个数字，
  // 光比返回值说明不了"没有建出第二条"。
  const postsBefore = sent.filter((line) => line.startsWith('POST ') && line.includes('/hr/contract-template/create')).length
  const replay = await template.createIdempotent({
    typeId: TYPE_ID,
    name: NAME,
    useSystem: USE_SYSTEM,
    content: EMPTY_TEMPLATE_CONTENT,
    requestId,
  })
  const postsAfter = sent.filter((line) => line.startsWith('POST ') && line.includes('/hr/contract-template/create')).length
  const afterReplay = await byName(NAME)
  process.stdout.write(`\n3. 同一个 requestId 重试一次\n`)
  check(afterReplay.total === 1, '列表仍然只有 1 条（没有建出第二条）', `实际 ${afterReplay.total} 条`)
  check(
    postsAfter === postsBefore,
    '第二次 POST 根本没发出去（防重命中，不是"发了但后端没重复建"）',
    `create 的 POST 次数 ${postsBefore} → ${postsAfter}`,
  )
  check(
    JSON.stringify(replay) === JSON.stringify(createdIdempotentResult),
    '回放的是第一次的返回值（两边都是同一个 id —— 这条本身证明力很弱，上面那两条才是证据）',
    `第一次 ${JSON.stringify(createdIdempotentResult)} / 重试 ${JSON.stringify(replay)}`,
  )

  // 4 改（整份覆写）
  const updated = {
    id: one.id,
    typeId: TYPE_ID,
    name: NAME2,
    useSystem: 1, // 人力
    content: EMPTY_TEMPLATE_CONTENT,
  }
  await template.update(updated)
  process.stdout.write(`\n4. update（改名 + 换所属系统）\n`)
  process.stdout.write(`   ${strip(sent[sent.length - 1])}\n`)
  const afterUpdate = await template.get(id)
  check(afterUpdate.name === NAME2, '名称已改', `读回 ${afterUpdate.name}`)
  check(Number(afterUpdate.useSystem) === 1, '所属系统已改', `读回 ${afterUpdate.useSystem}`)
  check(
    afterUpdate.status === 1,
    'status 仍是 1 —— 后端把 status 按 onlySubmit 重写成待提交（源码读出，这条是实测确认）',
    `读回 ${afterUpdate.status}`,
  )
  const oldName = await byName(NAME)
  check(oldName.total === 0, `旧名字「${NAME}」查不到了`, `实际 ${oldName.total} 条`)

  // 5 update 原样重发
  await template.update(updated)
  const afterUpdateTwice = await byName(NAME2)
  const reread = await template.get(id)
  process.stdout.write(`\n5. update 原样重发一次\n`)
  check(afterUpdateTwice.total === 1, '仍然只有 1 条', `实际 ${afterUpdateTwice.total} 条`)
  check(
    reread.name === NAME2 && Number(reread.useSystem) === 1 && reread.status === 1,
    '终态不变（update 不需要 requestId 的实测依据）',
    `${reread.name} / useSystem=${reread.useSystem} / status=${reread.status}`,
  )

  // 6 remove
  await template.remove(id)
  process.stdout.write(`\n6. remove\n`)
  process.stdout.write(`   ${strip(sent[sent.length - 1])}\n`)
  const afterRemove = await byName(NAME2)
  check(afterRemove.total === 0, '列表查不到了', `实际 ${afterRemove.total} 条`)
  const twice = await template.remove(id).then(
    () => 'ok',
    (error) => `err: ${error?.message || String(error)}`,
  )
  check(twice === 'ok', '重复 remove 后端直接返回成功（重发无副作用）', twice)

  // 7 逻辑删除的现场
  // 后端 `deleteContractTemplate` 走的是 `UpdateWrapper.set(deleted, true)`，
  // 而 `ContractTemplateDO` 继承的 `BaseDO` 上 `deleted` 带 `@TableLogic` ——
  // 所以 `selectById` 会自动补 `deleted = 0`，`get` **大概率查不到**（与班次管理那条线
  // 的"逻辑删除后 get 仍返回整行"相反）。**不断言具体是哪种**，把真实结果打出来。
  process.stdout.write(`\n7. remove 之后 get(id) —— 逻辑删除的现场\n`)
  let ghost
  try {
    ghost = await template.get(id)
    note(`get 返回：${ghost === null || ghost === undefined ? String(ghost) : JSON.stringify({ id: ghost.id, name: ghost.name, status: ghost.status })}`)
  } catch (error) {
    ghost = undefined
    note(`get 抛错：${error?.message || String(error)}`)
  }
  check(
    !(ghost && ghost.name === NAME2),
    'get 不会返回一条"还活着"的记录（删掉的东西不会假装还在）',
    ghost ? `返回了 name=${ghost.name}` : '没有返回记录 / 抛错',
  )

  // 8 收尾
  const finalA = await byName(NAME)
  const finalB = await byName(NAME2)
  const finalPrefix = await anyTestPrefix()
  process.stdout.write(`\n8. 收尾复核\n`)
  check(finalA.total === 0 && finalB.total === 0, '两个名字都查不到，测试数据没留下', `${finalA.total} / ${finalB.total}`)
  check(finalPrefix.total === 0, '整个 `SDK-TEST-` 前缀下也干净了', `实际 ${finalPrefix.total} 条`)

  // 9 只读探针：前端「保存并提交」第一步打的那个接口在后端到底有没有
  // **只读、不写**；就算它真的存在，也只是返回"这次要哪些审批人"，不会建单据。
  process.stdout.write(`\n9. 探针：POST /hr/contract-template/getRequiredStartUserSelectTasks（预期 404）\n`)
  const probe = await sdk
    .call(PAGE, { url: '/hr/contract-template/getRequiredStartUserSelectTasks', method: 'post', data: {} })
    .then(
      () => 'HTTP 2xx —— **这个映射是存在的**，SDK 的「只走仅保存」这个决定需要重新评估',
      (error) => `失败：${error?.message || String(error)}（后端没有这个映射，前端「保存并提交」第一步必挂）`,
    )
  note(probe)
  check(
    probe.startsWith('失败'),
    '「保存并提交」那一支在前端是断的 —— 与 `WorkflowContractTemplateController` 里没有这个映射一致',
    probe.slice(0, 80),
  )
} catch (error) {
  failures += 1
  process.stderr.write(`\n✗ 中途失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.code !== undefined) process.stderr.write(`  code=${error.code} ret=${error.ret}\n`)
  // 尽力清理：只删这一次任务里建出来的那条
  if (id !== undefined && id !== null) {
    await template.remove(id).then(
      () => process.stderr.write(`  已尽力清理记录 id=${id}\n`),
      (cleanupError) => process.stderr.write(`  清理失败（需要人工看一眼）：${cleanupError?.message}\n`),
    )
  }
}

process.stdout.write(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
