#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 环境**真的提交一张测试会议申请单**。
 *
 * ⚠️ 这是写操作——会创建单据并触发流程。只有在明确授权后才运行。
 *
 * 验证方式：提交前后各查一次该日期的会议室占用，看这条预定是否出现。
 *
 * 需要环境变量：
 *   PORTAL_BASE_URL / PORTAL_TOKEN / PORTAL_TENANT_ID
 * 可选：
 *   PORTAL_SMOKE_ROOM_ID   默认 5（博创小会议室）
 *   PORTAL_SMOKE_DATE      默认 2026-09-22
 *   PORTAL_SMOKE_NAME      默认 "无头SDK冒烟-可删除"
 *
 * 先构建：pnpm build
 */
import { createPortalHeadless } from '../dist/index.js'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(`缺少环境变量：${missing.join(', ')}\n`)
  process.exit(1)
}

const roomId = Number(process.env.PORTAL_SMOKE_ROOM_ID || 5)
const date = process.env.PORTAL_SMOKE_DATE || '2026-09-22'
const meetingName = process.env.PORTAL_SMOKE_NAME || '无头SDK冒烟-可删除'

const draft = {
  meetingName,
  meetingRoomId: roomId,
  startTime: `${date} 14:00:00`,
  endTime: `${date} 15:00:00`,
  attendeeCount: 2,
}

const sdk = createPortalHeadless({ baseUrl, credential: { token, tenantId } })

function slotsFor (usage, id) {
  // 注意：响应是 { organizationId, date, meetingRooms }，不是数组
  const rooms = Array.isArray(usage) ? usage : (usage?.meetingRooms || [])
  const room = rooms.find((r) => Number(r.meetingRoomId) === Number(id))
  if (!room) return []
  return (room.timeSlots || []).filter((s) => String(s.startTime || '').includes(`${date} 14:00`))
}

async function snapshotUsage (label) {
  const usage = await sdk.meetingApplication.roomUsage(date)
  const hit = slotsFor(usage, roomId)
  process.stdout.write(
    `${label}：会议室 ${roomId} 在 ${date} 14:00 的占用 —— ` +
      (hit.length === 0 ? '空\n' : `${hit.map((s) => `${s.meetingName || '(无名称)'}(${s.userName || '-'})`).join(', ')}\n`),
  )
  return hit
}

process.stdout.write(`载荷：${JSON.stringify({ ...draft, attendees: '' })}\n\n`)

try {
  await snapshotUsage('提交前')

  const { tasks, payload } = await sdk.meetingApplication.prepare(draft)
  process.stdout.write(`prepare：需人工指定审批人的节点 ${tasks.length} 个\n`)

  const assignees = Object.fromEntries(tasks.map((t) => [t.id, []]))
  const result = await sdk.meetingApplication.submit(draft, assignees)
  process.stdout.write(`submit：已提交，后端返回 ${JSON.stringify(result)}\n`)
  process.stdout.write(`已发送载荷：${JSON.stringify(payload)}\n\n`)

  const after = await snapshotUsage('提交后')
  process.stdout.write(
    after.length > 0
      ? '\n✅ 提交后该时段出现了这条预定，写链路端到端成立。\n'
      : '\n⚠️ 提交返回成功，但占用查询里没看到这条记录（可能被审批状态过滤或组织范围过滤）。\n',
  )

  // 收尾：把这张测试单撤掉，别把测试数据留在环境里。
  // 顺便验证第二个写接口。
  const createdId = Number(result)
  if (Number.isFinite(createdId) && createdId > 0 && process.env.PORTAL_SMOKE_KEEP !== '1') {
    await sdk.meetingApplication.cancelReservation(createdId)
    await snapshotUsage('取消后')
    process.stdout.write(`已取消测试单 #${createdId}（设 PORTAL_SMOKE_KEEP=1 可保留）\n`)
  }
} catch (error) {
  process.stderr.write(`\n调用失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.code !== undefined) process.stderr.write(`  code=${error.code} ret=${error.ret}\n`)
  process.exit(1)
}
