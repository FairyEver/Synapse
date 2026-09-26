#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 环境跑一遍「排班管理」的**写链路**
 * （建组 → 排班 → 改组 → 删组），页面 `/dashboard/attendance/attendance-team/list`。
 *
 * 需要三个环境变量（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL / PORTAL_TOKEN / PORTAL_TENANT_ID
 *
 * 运行：smoke/with-portal-token.sh node smoke/attendance-team-crud.mjs
 *
 * ## 它会真的写数据，所以规矩写在这里
 *
 * - 记录名一律 `SDK-TEST-` 前缀 + 时间戳后 6 位（页面规则限制名称 ≤20 字，所以不能更长）。
 * - **只碰自己建的这一个考勤组**，从不碰测试环境里原有的 3 个
 *   （删别人的记录是破坏性操作，这一条是硬规矩）。
 * - 排班只挂到一个**确认过没人被占用的组织**上（见 `ORG_ID` 的注释），并且**收尾必清空**。
 * - 收尾复核：按两个名字各查一次列表，都必须是 0 条。
 *
 * ## 「独立证实」是什么
 *
 * 这个页面**没有第二个视图**（不像会议室预定能去占用查询里看），所以证实只能靠
 * **同一接口的两次独立读取**：建完按名字查列表、再按 id 取详情，且提交值与读回值逐项比对。
 * 排班那一层稍好一点：`scheduleSave` 之后用 `scheduleGet`（**另一个接口**）读回来，
 * 能看到后端自己拼出来的组织名 —— 这比"写接口返回成功"强。
 *
 * ## 步骤
 *
 *   0. 起手：按名字查列表 —— 必须是 0 条（排除"本来就有一条"这种假阳性）
 *   1. create（经 `createIdempotent`，D12）→ 独立证实①：按名字查列表恰好 1 条
 *   2. 独立证实②：按 id 取详情，name / type / shiftId 逐项一致；记下 createTime / creator
 *   3. 同一个 requestId 重试 —— 列表仍 1 条，且 save 的 POST 次数没变（第二次根本没发出去）
 *   4. scheduleGet —— 新建的组没排过班：列表是 **null**（不是 []）、startDate 也是 null
 *   5. scheduleSave（挂一个组织）→ 独立证实③：scheduleGet 读回 startDate + 后端拼出的组织名
 *   6. scheduleSave 原样重发 —— 终态不变（schedule-save 不需要 requestId 的实测依据）
 *   7. **此时 remove 必须失败**：组里有排班，后端返回「该考勤组正在使用，无法删除!」
 *      —— 这条错误路径是**真的触发过**的（班次管理那条线只从代码读出来）
 *   8. scheduleSave 传空列表清空 → scheduleGet 读回 null（删组之前的必要一步）
 *   9. update（先 get 再改）→ get：名称变了、createTime/creator 一字未动、shiftName 仍拼得出
 *  10. update 原样重发一次 —— 仍 1 条，终态不变
 *  11. remove → 列表查不到；重复 remove 后端仍返回成功
 *  12. remove 之后 get 仍返回这一行、isDel=1 —— 逻辑删除的现场（要确认删干净只能看列表）
 *  13. 收尾：按两个名字各查一次 —— 0 条
 */
import axios from 'axios'

// 防重那三个从**门面**取（`src/index.ts` 已经导出它们），不从 `src/idempotency/` 直接 import：
// `.mjs` import TS 源码时 Node 不会把源码里的 `./xxx.js` 重新映射到 `.ts`，
// 而 `src/idempotency/index.ts` 有一堆**值**导入（不是 type-only），解析不了。
// 本页的能力文件之所以能从 `../src/` 直接 import，是因为它内部只有 `import type`，会被整句擦掉。
import { IdempotencyStore, createPortalHeadless, createRequestId, withIdempotency } from '../dist/index.js'
import {
  ATTENDANCE_TEAM_PAGE_PATH,
  buildGroupPayload,
  createAttendanceTeamCapability,
} from '../src/capabilities/attendance-team.ts'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法：smoke/with-portal-token.sh node smoke/attendance-team-crud.mjs\n',
  )
  process.exit(1)
}

const PAGE = ATTENDANCE_TEAM_PAGE_PATH
const sdk = createPortalHeadless({ baseUrl, credential: { token, tenantId } })

/** 手工接线：能力实现与门面用的是同一个 `call`（见 read 那份脚本的文件头） */
const teamBase = createAttendanceTeamCapability((config) => sdk.call(PAGE, config))

/**
 * `createIdempotent` 的接线与 `src/index.ts` 里班次管理那段**逐字同构**，
 * 只是 capabilityId 换成本页的。门面接线后这一段可以删掉。
 */
const team = {
  ...teamBase,
  createIdempotent: withIdempotency({
    store: new IdempotencyStore({}),
    capabilityId: 'attendance-team-create',
    identity: () => ({ userId: 'smoke', tenantId }),
    payload: (params) => buildGroupPayload(params),
    send: (_params, { payload }) => teamBase.create(payload),
  }),
}

/**
 * 用来排班的组织：**北京思玛特职能**。
 *
 * 为什么是这个 id（2026-09-20 选它之前做过只读探测，不是随便挑的）：
 *   - 它只有 5 个人（`getUserByType` type=1 实测），排班的影响面最小；
 *   - 这 5 个**工号**都不在测试环境原有的 3 个考勤组里 —— 后端 `saveWorkSchedule`
 *     会拿「选出来的人有没有在别的组」当冲突判据，撞上就返回 500
 *     「所选人员在别的考勤组存在,请重新选择」。
 *
 * ⚠️ 这个前提**会过期**：谁把这 5 个人加进别的考勤组，这一条就会红。
 * 真过期了不要改成"换个 id 再试"，先重新探测再把新前提写在这里（派单规矩第 7 条）。
 */
const ORG_ID = 70669

const sent = []
const innerAdapter = axios.getAdapter(axios.defaults.adapter)
sdk.http.defaults.adapter = async (config) => {
  sent.push(`${String(config.method).toUpperCase()} ${String(config.url)}`)
  return innerAdapter(config)
}
const strip = (url) => url.replace(/([?&]_t=)\d+/, '$1<ts>')
const countPosts = (needle) => sent.filter((line) => line.startsWith('POST ') && line.includes(needle)).length

const resolved = sdk.resolveModuleType(PAGE)
process.stdout.write(
  `页面：${PAGE}\n` +
    `module-type：${resolved.moduleType} ${resolved.label}\n` +
    `写链路：create → 排班 → （删组被拦）→ 清排班 → update → remove（记录名一律 SDK-TEST- 前缀）\n\n`,
)

const stamp = String(Date.now()).slice(-6)
const NAME = `SDK-TEST-组-${stamp}` // 17 字，在页面规则 20 字以内
// ⚠️ 改后的名字**不能包含原名**：name 是模糊匹配，否则"旧名字查不到了"这条断言会假绿
//（作业管理那条线上踩过这个坑）。
const NAME2 = `SDK-TEST-改-${stamp}`
const START_DATE = '2026-09-01'

let failures = 0
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1
  process.stdout.write(`   ${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}\n`)
}

/** 按名字查列表，返回 {total, list}（这个页面的独立证实只能用同一接口的两次读） */
async function byName (name) {
  return team.list({ name, pageNo: 1, pageSize: 20 })
}

let id
let scheduleTouched = false
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
  createdIdempotentResult = await team.createIdempotent({
    name: NAME,
    type: 1,
    shiftId: '5', // 复用现成的「沃德博创考勤班次」，不新建班次
    requestId,
  })
  process.stdout.write(`\n1. create（createIdempotent，requestId=${requestId}）\n`)
  process.stdout.write(`   ${strip(sent[sent.length - 1])}\n`)
  const afterCreate = await byName(NAME)
  check(afterCreate.total === 1, '独立证实① 按名字查列表恰好 1 条', `实际 ${afterCreate.total} 条`)
  id = afterCreate.list[0]?.id
  // 顺手记下 id 的类型：后端把 Long 序列化成**字符串**（基准里浏览器回传的是 `"id":"7"`），
  // 这个观察要在文档里如实写出来，别让调用方以为拿到的是 number
  check(id !== undefined && id !== null, `拿到新记录 id=${JSON.stringify(id)}（typeof ${typeof id}）`)

  // 2 详情逐项比对
  const one = await team.get(id)
  process.stdout.write(`\n2. 独立证实② 按 id 取详情（${strip(sent[sent.length - 1])}）\n`)
  check(one.name === NAME, 'name 与提交值一致', `读回 ${one.name}`)
  check(one.type === 1, 'type 与提交值一致', `读回 ${one.type}`)
  check(String(one.shiftId) === '5', 'shiftId 与提交值一致', `读回 ${JSON.stringify(one.shiftId)}`)
  check(
    one.workShift !== null && one.workShift !== undefined && one.workShift.name === '沃德博创考勤班次',
    '详情比列表多返回 workShift（班次明细）',
    `workShift.name=${JSON.stringify(one.workShift?.name ?? null)}`,
  )

  // 3 同一个 requestId 重试
  // 真正的证据是"第二次有没有真的发出去"——只比对返回值是**恒真**的：
  // `save` 后端返回的就是空 Result，两次都是 null，null === null 说明不了任何事。
  const postsBefore = countPosts('/hrAttendanceGroup')
  const replay = await team.createIdempotent({ name: NAME, type: 1, shiftId: '5', requestId })
  const postsAfter = countPosts('/hrAttendanceGroup')
  const afterReplay = await byName(NAME)
  process.stdout.write(`\n3. 同一个 requestId 重试一次\n`)
  check(afterReplay.total === 1, '列表仍然只有 1 条（没有建出第二个组）', `实际 ${afterReplay.total} 条`)
  check(
    postsAfter === postsBefore,
    '第二次 POST 根本没发出去（防重命中，不是"发了但后端没重复建"）',
    `建组的 POST 次数 ${postsBefore} → ${postsAfter}`,
  )
  check(
    JSON.stringify(replay) === JSON.stringify(createdIdempotentResult),
    '回放的是第一次的返回值（两边都是 null —— 后端 save 不回数据，这条本身证明力很弱）',
    `第一次 ${JSON.stringify(createdIdempotentResult)} / 重试 ${JSON.stringify(replay)}`,
  )

  // 4 新组的排班是空的
  const empty = await team.scheduleGet(id)
  process.stdout.write(`\n4. scheduleGet（新建的组还没排过班）\n`)
  process.stdout.write(`   ${strip(sent[sent.length - 1])}\n`)
  check(
    empty.hrGroupUserRelEntityList === null,
    'hrGroupUserRelEntityList 是 null（**不是空数组** —— 后端只在集合非空时才 set）',
    JSON.stringify(empty.hrGroupUserRelEntityList),
  )
  check(empty.startDate === null || empty.startDate === undefined, 'startDate 也是空', JSON.stringify(empty.startDate ?? null))

  // 5 排班：挂一个组织
  scheduleTouched = true
  await team.scheduleSave({ groupId: id, startDate: START_DATE, organizationIdList: [ORG_ID] })
  process.stdout.write(`\n5. scheduleSave（挂组织 ${ORG_ID}）\n`)
  process.stdout.write(`   ${strip(sent[sent.length - 1])}\n`)
  const filled = await team.scheduleGet(id)
  const members = filled.hrGroupUserRelEntityList ?? []
  check(filled.startDate === START_DATE, '独立证实③ scheduleGet 读回 startDate', `读回 ${JSON.stringify(filled.startDate)}`)
  check(
    members.length === 1 && members[0]?.type === 1 && String(members[0]?.paramsId) === String(ORG_ID),
    '读回恰好 1 条 type=1 的挂载项，paramsId 就是传进去的组织',
    members.map((m) => `type=${m.type}:${m.paramsId}`).join(',') || '(空)',
  )
  check(
    typeof members[0]?.name === 'string' && members[0].name.length > 0,
    '后端把它拼成了可读的组织名（这是「另一个接口读回来」的独立证据，不是写接口自报成功）',
    `name=${JSON.stringify(members[0]?.name ?? null)}`,
  )
  check(members[0]?.endDate === '2099-12-31', '结束日由后端固定写成 2099-12-31（"长期有效"）', String(members[0]?.endDate))

  // 6 schedule-save 原样重发
  await team.scheduleSave({ groupId: id, startDate: START_DATE, organizationIdList: [ORG_ID] })
  const afterResend = await team.scheduleGet(id)
  process.stdout.write(`\n6. scheduleSave 原样重发一次\n`)
  check(
    (afterResend.hrGroupUserRelEntityList ?? []).length === 1,
    '读回仍然只有 1 条挂载项（终态相同，不是"再挂一遍"）',
    `实际 ${(afterResend.hrGroupUserRelEntityList ?? []).length} 条`,
  )
  check(afterResend.startDate === START_DATE, 'startDate 不变', JSON.stringify(afterResend.startDate))

  // 7 有排班时删组必须被拦
  const blocked = await team.remove(id).then(
    () => 'ok',
    (error) => `err: ${error?.message || String(error)}`,
  )
  process.stdout.write(`\n7. 有排班时 remove 应该被拦（这条错误路径要真的触发一次）\n`)
  check(blocked !== 'ok', '删除被后端拒绝（不是静默成功）', blocked)
  check(
    typeof blocked === 'string' && blocked.includes('正在使用'),
    '错误信息是「该考勤组正在使用，无法删除!」',
    blocked,
  )
  const stillThere = await byName(NAME)
  check(stillThere.total === 1, '被拦下之后组还在（确实是拒绝了，不是删了但报错）', `实际 ${stillThere.total} 条`)

  // 8 清空排班 —— 删组之前的必要一步
  await team.scheduleSave({ groupId: id, startDate: START_DATE })
  const cleared = await team.scheduleGet(id)
  scheduleTouched = false
  process.stdout.write(`\n8. scheduleSave 传空列表 = 清空该组排班\n`)
  check(
    cleared.hrGroupUserRelEntityList === null ||
      (cleared.hrGroupUserRelEntityList ?? []).length === 0,
    '排班已清空',
    JSON.stringify(cleared.hrGroupUserRelEntityList ?? null),
  )
  check(cleared.startDate === null || cleared.startDate === undefined, 'startDate 也跟着没了', JSON.stringify(cleared.startDate ?? null))

  // 9 先 get 再改（整单替换的正确用法）
  const current = await team.get(id)
  const updated = { name: NAME2, type: 1, shiftId: current.shiftId }
  await team.update({ id: current.id, ...updated })
  process.stdout.write(`\n9. update（先 get 再改）\n`)
  process.stdout.write(`   ${strip(sent[sent.length - 1])}\n`)
  const afterUpdate = await team.get(id)
  check(afterUpdate.name === NAME2, '名称已改', `读回 ${afterUpdate.name}`)
  check(
    afterUpdate.createTime === one.createTime && String(afterUpdate.creator) === String(one.creator),
    'createTime / creator 没被这次 PUT 动过（只发三个业务键 + id 是安全的）',
    `createTime ${one.createTime} → ${afterUpdate.createTime}`,
  )
  check(afterUpdate.status === one.status, 'status 没被动过', `${one.status} → ${afterUpdate.status}`)
  // ⚠️ `get` 的响应里 `shiftName` **恒为 null** —— 后端 `getInfo` 没有调 `dealShift`，
  // 那个字段只有**列表**才拼（实测，见 read 脚本的 ③）。所以这条必须回列表看，不能看 get。
  const renamed = await byName(NAME2)
  check(
    renamed.list[0]?.shiftName !== null && renamed.list[0]?.shiftName !== undefined,
    'shiftId 没被写空（回列表看 shiftName 仍拼得出来；get 的 shiftName 恒为 null）',
    `list.shiftName=${JSON.stringify(renamed.list[0]?.shiftName ?? null)} / get.shiftName=${JSON.stringify(afterUpdate.shiftName ?? null)}`,
  )
  const oldName = await byName(NAME)
  check(oldName.total === 0, `旧名字「${NAME}」查不到了`, `实际 ${oldName.total} 条`)

  // 10 update 原样重发
  await team.update({ id: current.id, ...updated })
  const afterUpdateTwice = await byName(NAME2)
  const reread = await team.get(id)
  process.stdout.write(`\n10. update 原样重发一次\n`)
  check(afterUpdateTwice.total === 1, '仍然只有 1 条', `实际 ${afterUpdateTwice.total} 条`)
  check(
    reread.name === NAME2 && String(reread.shiftId) === String(one.shiftId),
    '终态不变（update 不需要 requestId 的实测依据）',
    `${reread.name} / shiftId ${reread.shiftId}`,
  )

  // 11 remove
  await team.remove(id)
  process.stdout.write(`\n11. remove\n`)
  process.stdout.write(`   ${strip(sent[sent.length - 1])}\n`)
  const afterRemove = await byName(NAME2)
  check(afterRemove.total === 0, '列表查不到了', `实际 ${afterRemove.total} 条`)
  const twice = await team.remove(id).then(
    () => 'ok',
    (error) => `err: ${error?.message || String(error)}`,
  )
  check(twice === 'ok', '重复 remove 后端直接返回成功（重发无副作用）', twice)

  // 12 逻辑删除的现场
  const ghost = await team.get(id)
  process.stdout.write(`\n12. 逻辑删除的现场（remove 之后 get）\n`)
  check(
    ghost !== null && ghost !== undefined && String(ghost.id) === String(id),
    'get 仍返回这一行 —— 所以「删干净了没有」只能看列表，不能看 get',
    `${ghost?.name} isDel=${JSON.stringify(ghost?.isDel)}`,
  )

  // 13 收尾
  const finalA = await byName(NAME)
  const finalB = await byName(NAME2)
  process.stdout.write(`\n13. 收尾复核\n`)
  check(finalA.total === 0 && finalB.total === 0, '两个名字都查不到，测试数据没留下', `${finalA.total} / ${finalB.total}`)
} catch (error) {
  failures += 1
  process.stderr.write(`\n✗ 中途失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.code !== undefined) process.stderr.write(`  code=${error.code} ret=${error.ret}\n`)
  // 尽力清理：只删这一次任务里建出来的那一条。**先清排班再删组** —— 有排班时后端会拦住删除。
  if (id !== undefined && id !== null) {
    if (scheduleTouched) {
      await team.scheduleSave({ groupId: id, startDate: START_DATE }).then(
        () => process.stderr.write('  已清空该组的排班\n'),
        (cleanupError) => process.stderr.write(`  清排班失败（需要人工看一眼）：${cleanupError?.message}\n`),
      )
    }
    await team.remove(id).then(
      () => process.stderr.write(`  已尽力清理记录 id=${id}\n`),
      (cleanupError) => process.stderr.write(`  清理失败（需要人工看一眼）：${cleanupError?.message}\n`),
    )
  }
}

process.stdout.write(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}\n`)
process.exit(failures === 0 ? 0 : 1)
