#!/usr/bin/env node
/**
 * 冒烟：对真实 Portal 环境跑一次「提交前准备」。
 *
 * **只读**——它只调用 getRequiredStartUserSelectTasks（服务端据此算需要哪些审批人），
 * 不会创建任何单据、不会触发流程。
 *
 * 需要三个环境变量（凭据不落盘、不进代码）：
 *   PORTAL_BASE_URL   例如 https://biz-api-test.wodecorp.cn
 *   PORTAL_TOKEN      Portal 会话 token
 *   PORTAL_TENANT_ID  当前租户 id
 *
 * 先构建：pnpm build
 * 再运行：PORTAL_BASE_URL=... PORTAL_TOKEN=... PORTAL_TENANT_ID=... pnpm smoke:prepare
 *
 * 会议名称/时间段可用环境变量覆盖，默认取的是一次未来时间的样例。
 */
import { createPortalHeadless } from '../dist/index.js'

const baseUrl = process.env.PORTAL_BASE_URL
const token = process.env.PORTAL_TOKEN
const tenantId = process.env.PORTAL_TENANT_ID

const missing = Object.entries({ PORTAL_BASE_URL: baseUrl, PORTAL_TOKEN: token, PORTAL_TENANT_ID: tenantId })
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length) {
  process.stderr.write(
    `缺少环境变量：${missing.join(', ')}\n\n` +
      '用法：\n' +
      '  PORTAL_BASE_URL=https://biz-api-test.wodecorp.cn \\\n' +
      '  PORTAL_TOKEN=<会话 token> \\\n' +
      '  PORTAL_TENANT_ID=<租户 id> \\\n' +
      '  pnpm smoke:prepare\n',
  )
  process.exit(1)
}

/** 造一个「明天 14:00-15:00」的样例（分钟必须是 00 或 30） */
function sampleDraft () {
  const start = new Date()
  start.setDate(start.getDate() + 1)
  start.setHours(14, 0, 0, 0)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  const fmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`
  return {
    meetingName: process.env.PORTAL_SMOKE_MEETING_NAME || '无头 SDK 冒烟（不会提交）',
    meetingRoomId: Number(process.env.PORTAL_SMOKE_ROOM_ID || 12),
    startTime: fmt(start),
    endTime: fmt(end),
    attendeeCount: 2,
  }
}

const sdk = createPortalHeadless({ baseUrl, credential: { token, tenantId } })
const draft = sampleDraft()

process.stdout.write(
  `本次只跑 prepare（只读，不会创建单据）\n` +
    `载荷：${JSON.stringify({ ...draft, attendees: '' })}\n\n`,
)

try {
  const { payload, tasks } = await sdk.meetingApplication.prepare(draft)
  process.stdout.write(`后端接受了载荷，回包 payload.meetingRoomId=${payload.meetingRoomId}\n`)
  if (tasks.length === 0) {
    process.stdout.write('需要人工指定的审批人节点：0 个（该流程无需选审批人）\n')
  } else {
    process.stdout.write(`需要人工指定的审批人节点：${tasks.length} 个\n`)
    for (const task of tasks) {
      process.stdout.write(
        `  - ${task.name}（${task.id}）最少 ${task.minSelectCount ?? '-'} 最多 ${task.maxSelectCount ?? '-'}\n`,
      )
    }
  }
} catch (error) {
  process.stderr.write(`\n调用失败：${error?.name || 'Error'} — ${error?.message || String(error)}\n`)
  if (error?.code !== undefined) process.stderr.write(`  code=${error.code} ret=${error.ret}\n`)
  process.exit(1)
}
