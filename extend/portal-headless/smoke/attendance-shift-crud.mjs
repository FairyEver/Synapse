#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 环境跑一遍「班次管理」的**写链路**（新建 → 改 → 删），
 * 页面 `/dashboard/attendance/attendance-shift/list`。
 *
 * 需要三个环境变量（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL / PORTAL_TOKEN / PORTAL_TENANT_ID
 *
 * 运行：smoke/with-portal-token.sh node smoke/attendance-shift-crud.mjs
 *
 * ## 它会真的写数据，所以规矩写在这里
 *
 * - 记录名一律 `SDK-TEST-` 前缀 + 时间戳后 6 位（页面规则限制名称 ≤20 字，
 *   所以不能更长）。一眼能看出是测试数据。
 * - **只删自己建的这一条**，从不碰测试环境里原有的 3 条班次
 *   （删别人的记录是破坏性操作，这一条是硬规矩）。
 * - 收尾复核：按两个名字各查一次列表，都必须是 0 条。
 *
 * ## 「独立证实」是什么
 *
 * 这个页面**没有第二个视图**（不像会议室预定能去占用查询里看），所以证实只能靠
 * **同一接口的两次独立读取**：建完按名字查列表、再按 id 取详情，且提交值与读回值逐项比对。
 * 这条差别在作业管理那条线上已经记过一次，这里同理。
 *
 * ## 步骤
 *
 *   0. 起手：按名字查列表 —— 必须是 0 条（排除"本来就有一条"这种假阳性）
 *   1. create（经 `createIdempotent`，D12）→ 独立证实①：按名字查列表恰好 1 条
 *   2. 独立证实②：按 id 取详情，四个时间与提交值逐项一致
 *   3. 同一个 requestId 重试 —— 列表仍 1 条，回放第一次的返回值
 *   4. update（先 get 再改）→ get：名称与时间都变了
 *   5. update 原样重发一次 —— 仍 1 条，终态不变（update 不需要 requestId 的实测依据）
 *   6. remove → 列表查不到；重复 remove 后端仍返回成功
 *   7. remove 之后 get 仍返回这一行、isDel=1 —— 逻辑删除的现场（要确认删干净只能看列表）
 *   8. 收尾：按两个名字各查一次 —— 0 条
 */
import axios from 'axios'

// 防重那三个从**门面**取（`src/index.ts` 已经导出它们），不从 `src/idempotency/` 直接 import：
// `.mjs` import TS 源码时 Node 不会把源码里的 `./xxx.js` 重新映射到 `.ts`，
// 而 `src/idempotency/index.ts` 有一堆**值**导入（不是 type-only），解析不了。
// 本页的能力文件之所以能从 `../src/` 直接 import，是因为它内部只有 `import type`，会被整句擦掉。
import { IdempotencyStore, createPortalHeadless, createRequestId, withIdempotency } from '../dist/index.js'
import {
  ATTENDANCE_SHIFT_PAGE_PATH,
  buildShiftPayload,
  createAttendanceShiftCapability,
} from '../src/capabilities/attendance-shift.ts'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法：smoke/with-portal-token.sh node smoke/attendance-shift-crud.mjs\n',
  )
  process.exit(1)
}

const PAGE = ATTENDANCE_SHIFT_PAGE_PATH
const sdk = createPortalHeadless({ baseUrl, credential: { token, tenantId } })

/** 手工接线：能力实现与门面用的是同一个 `call`（见 read 那份脚本的文件头） */
const shiftBase = createAttendanceShiftCapability((config) => sdk.call(PAGE, config))

/**
 * `createIdempotent` 的接线与 `src/index.ts:176-184` 里作业管理那段**逐字同构**，
 * 只是 capabilityId 换成本页的。门面接线后这一段可以删掉。
 */
const shift = {
  ...shiftBase,
  createIdempotent: withIdempotency({
    store: new IdempotencyStore({}),
    capabilityId: 'attendance-shift-create',
    identity: () => ({ userId: 'smoke', tenantId }),
    payload: (params) => buildShiftPayload(params),
    send: (_params, { payload }) => shiftBase.create(payload),
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
    `写链路：create → get 复核 → update → remove（记录名一律 SDK-TEST- 前缀）\n\n`,
)

const stamp = String(Date.now()).slice(-6)
const NAME = `SDK-TEST-班-${stamp}` // 15 字，在页面规则 20 字以内
// ⚠️ 改后的名字**不能包含原名**：name 是模糊匹配，否则"旧名字查不到了"这条断言会假绿
//（作业管理那条线上踩过这个坑）。
const NAME2 = `SDK-TEST-改-${stamp}`
const TIMES = {
  morningStartTime: '07:30:00',
  morningEndTime: '11:00:00',
  afternoonStartTime: '14:00:00',
  afternoonEndTime: '18:30:00',
}

let failures = 0
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1
  process.stdout.write(`   ${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}\n`)
}

/** 按名字查列表，返回 {total, list}（这个页面的独立证实只能用同一接口的两次读） */
async function byName (name) {
  return shift.list({ name, pageNo: 1, pageSize: 20 })
}

let id
let createdIdempotentResult

try {
  // 0 起手
  const before = await byName(NAME)
  process.stdout.write(`0. 起手：按名字查列表\n`)
  check(before.total === 0, `「${NAME}」建之前是 0 条`, `实际 ${before.total} 条`)
  if (before.total !== 0) {
    process.stderr.write('\n✗ 起手就不干净，中止（不做任何写操作）\n')
    process.exit(1)
  }

  // 1 create（带防重）
  const requestId = createRequestId()
  createdIdempotentResult = await shift.createIdempotent({ name: NAME, ...TIMES, requestId })
  process.stdout.write(`\n1. create（createIdempotent，requestId=${requestId}）\n`)
  process.stdout.write(`   ${strip(sent[sent.length - 1])}\n`)
  const afterCreate = await byName(NAME)
  check(afterCreate.total === 1, '独立证实① 按名字查列表恰好 1 条', `实际 ${afterCreate.total} 条`)
  id = afterCreate.list[0]?.id
  // 顺手记下 id 的类型：后端把 Long 序列化成**字符串**（基准里浏览器回传的是 `"id":"9"`），
  // 这个观察要在文档里如实写出来，别让调用方以为拿到的是 number
  check(id !== undefined && id !== null, `拿到新记录 id=${JSON.stringify(id)}（typeof ${typeof id}）`)

  // 2 详情逐项比对
  const one = await shift.get(id)
  process.stdout.write(`\n2. 独立证实② 按 id 取详情（${strip(sent[sent.length - 1])}）\n`)
  check(one.name === NAME, 'name 与提交值一致', `读回 ${one.name}`)
  for (const [key, value] of Object.entries(TIMES)) {
    check(one[key] === value, `${key} 与提交值一致`, `读回 ${one[key]}`)
  }
  void one

  // 3 同一个 requestId 重试
  // 真正的证据是"第二次有没有真的发出去"——只比对返回值是**恒真**的：
  // `save` 后端返回的就是空 Result，两次都是 null，null === null 说明不了任何事。
  const postsBefore = sent.filter((line) => line.startsWith('POST ') && line.includes('/hrWorkShift/save')).length
  const replay = await shift.createIdempotent({ name: NAME, ...TIMES, requestId })
  const postsAfter = sent.filter((line) => line.startsWith('POST ') && line.includes('/hrWorkShift/save')).length
  const afterReplay = await byName(NAME)
  process.stdout.write(`\n3. 同一个 requestId 重试一次\n`)
  check(afterReplay.total === 1, '列表仍然只有 1 条（没有建出第二条）', `实际 ${afterReplay.total} 条`)
  check(
    postsAfter === postsBefore,
    '第二次 POST 根本没发出去（防重命中，不是"发了但后端没重复建"）',
    `save 的 POST 次数 ${postsBefore} → ${postsAfter}`,
  )
  check(
    JSON.stringify(replay) === JSON.stringify(createdIdempotentResult),
    '回放的是第一次的返回值（两边都是 null —— 后端 save 不回数据，这条本身证明力很弱）',
    `第一次 ${JSON.stringify(createdIdempotentResult)} / 重试 ${JSON.stringify(replay)}`,
  )

  // 4 先 get 再改（整单替换的正确用法）
  const current = await shift.get(id)
  const updated = { ...TIMES, name: NAME2, morningStartTime: '08:15:00' }
  await shift.update({ id: current.id, ...updated })
  process.stdout.write(`\n4. update（先 get 再改）\n`)
  process.stdout.write(`   ${strip(sent[sent.length - 1])}\n`)
  const afterUpdate = await shift.get(id)
  check(afterUpdate.name === NAME2, '名称已改', `读回 ${afterUpdate.name}`)
  check(afterUpdate.morningStartTime === '08:15:00', '上午开始时间已改', `读回 ${afterUpdate.morningStartTime}`)
  check(
    afterUpdate.createTime === one.createTime && String(afterUpdate.creator) === String(one.creator),
    'createTime / creator 没被这次 PUT 动过（只发五个业务键 + id 是安全的）',
    `createTime ${one.createTime} → ${afterUpdate.createTime}`,
  )
  const oldName = await byName(NAME)
  check(oldName.total === 0, `旧名字「${NAME}」查不到了`, `实际 ${oldName.total} 条`)

  // 5 update 原样重发
  await shift.update({ id: current.id, ...updated })
  const afterUpdateTwice = await byName(NAME2)
  const reread = await shift.get(id)
  process.stdout.write(`\n5. update 原样重发一次\n`)
  check(afterUpdateTwice.total === 1, '仍然只有 1 条', `实际 ${afterUpdateTwice.total} 条`)
  check(
    reread.name === NAME2 && reread.morningStartTime === '08:15:00',
    '终态不变（update 不需要 requestId 的实测依据）',
    `${reread.name} / ${reread.morningStartTime}`,
  )

  // 6 remove
  await shift.remove(id)
  process.stdout.write(`\n6. remove\n`)
  process.stdout.write(`   ${strip(sent[sent.length - 1])}\n`)
  const afterRemove = await byName(NAME2)
  check(afterRemove.total === 0, '列表查不到了', `实际 ${afterRemove.total} 条`)
  const twice = await shift.remove(id).then(
    () => 'ok',
    (error) => `err: ${error?.message || String(error)}`,
  )
  check(twice === 'ok', '重复 remove 后端直接返回成功（重发无副作用）', twice)

  // 7 逻辑删除的现场
  const ghost = await shift.get(id)
  process.stdout.write(`\n7. 逻辑删除的现场（remove 之后 get）\n`)
  check(
    ghost !== null && ghost !== undefined && String(ghost.id) === String(id),
    'get 仍返回这一行 —— 所以「删干净了没有」只能看列表，不能看 get',
    `${ghost?.name} isDel=${JSON.stringify(ghost?.isDel)}`,
  )

  // 8 收尾
  const finalA = await byName(NAME)
  const finalB = await byName(NAME2)
  process.stdout.write(`\n8. 收尾复核\n`)
  check(finalA.total === 0 && finalB.total === 0, '两个名字都查不到，测试数据没留下', `${finalA.total} / ${finalB.total}`)
} catch (error) {
  failures += 1
  process.stderr.write(`\n✗ 中途失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.code !== undefined) process.stderr.write(`  code=${error.code} ret=${error.ret}\n`)
  // 尽力清理：只删这一次任务里建出来的那条
  if (id !== undefined && id !== null) {
    await shift.remove(id).then(
      () => process.stderr.write(`  已尽力清理记录 id=${id}\n`),
      (cleanupError) => process.stderr.write(`  清理失败（需要人工看一眼）：${cleanupError?.message}\n`),
    )
  }
}

process.stdout.write(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
